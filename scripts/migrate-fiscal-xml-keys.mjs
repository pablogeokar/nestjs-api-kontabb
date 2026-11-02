import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import postgres from 'postgres';

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
if (limitArg && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error('--limit deve ser um inteiro positivo');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (
  !['localhost', '127.0.0.1'].includes(databaseUrl.hostname) ||
  process.env.R2_BUCKET_NAME !== 'teste'
) {
  throw new Error('Migração restrita ao banco local e ao bucket R2 teste.');
}

const bucket = process.env.R2_BUCKET_NAME;
const db = postgres(process.env.DATABASE_URL, { max: 4 });
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const oldPath = /^clientes\/([^/]+)\/fiscais\/(\d{4})\/(\d{2})\/([^/]+)\/([^/]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xml$/i;
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function download(key) {
  const object = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!object.Body) throw new Error(`Objeto sem conteúdo: ${key}`);
  return Buffer.from(await object.Body.transformToByteArray());
}

async function migrate(row) {
  const match = oldPath.exec(row.xml_key);
  if (!match || match[5] !== row.chave_acesso) return 'invalid';
  const canonical = `clientes/${match[1]}/fiscais/${match[2]}/${match[3]}/${match[4]}/${match[5]}.xml`;
  const [otherReference] = await db`
    select count(*)::int as total from documentos_fiscais
    where xml_key = ${canonical} and id <> ${row.id}
  `;
  if (otherReference.total) return 'conflict';
  const source = await download(row.xml_key);
  try {
    await r2.send(new PutObjectCommand({
      Bucket: bucket, Key: canonical, Body: source,
      ContentType: 'application/xml', ContentLength: source.length,
      IfNoneMatch: '*',
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412) throw error;
  }
  const destination = await download(canonical);
  if (digest(source) !== digest(destination)) return 'conflict';
  const updated = await db`
    update documentos_fiscais set xml_key = ${canonical}
    where id = ${row.id} and xml_key = ${row.xml_key}
    returning id
  `;
  if (updated.length !== 1) return 'changed';
  const [remaining] = await db`
    select count(*)::int as total from documentos_fiscais
    where xml_key = ${row.xml_key}
  `;
  if (remaining.total === 0) {
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.xml_key }));
  }
  return 'migrated';
}

try {
  const rows = await db`
    select id, chave_acesso, xml_key from documentos_fiscais
    where xml_key ~ ${'/[0-9a-fA-F-]{36}\\.xml$'}
    order by id
  `;
  console.log(`${rows.length} registros candidatos no banco local (bucket ${bucket}).`);
  if (!apply) {
    console.log('Prévia apenas. Use --apply para copiar, validar e atualizar.');
  } else {
    const counts = { migrated: 0, invalid: 0, conflict: 0, changed: 0, error: 0 };
    const selected = rows.slice(0, limit);
    let next = 0;
    let finished = 0;
    async function worker() {
      while (next < selected.length) {
        const row = selected[next++];
        try {
          const result = await migrate(row);
          counts[result]++;
          if (result !== 'migrated') console.error(`${result}: ${row.id}`);
        } catch (error) {
          counts.error++;
          console.error(`error: ${row.id}: ${error.message}`);
        }
        finished++;
        if (finished % 100 === 0) console.log(`${finished}/${selected.length}: ${JSON.stringify(counts)}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(12, selected.length) }, () => worker()));
    console.log(`Resultado: ${JSON.stringify(counts)}`);
    if (counts.error || counts.conflict || counts.invalid) process.exitCode = 1;
  }
} finally {
  await db.end();
  r2.destroy();
}
