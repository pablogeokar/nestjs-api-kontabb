#!/usr/bin/env node
/**
 * Limpa NF-e de DFe em que o cliente só aparece como transportador.
 * Consulte docs/limpeza-nfe-transportador-r2.md para prévia, execução e retomada.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import postgres from 'postgres';

const SOURCE = 'cleanup-nfe-transportador-r2/v1';
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function argsFrom(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute' || arg === '--resume-r2') {
      result[arg.slice(2)] = true;
    } else if (
      arg === '--cnpj' ||
      arg === '--manifest' ||
      arg === '--expect-database' ||
      arg === '--expect-bucket'
    ) {
      result[arg.slice(2)] = argv[++i];
    } else {
      throw new Error(`Argumento inválido: ${arg}`);
    }
  }
  if (!/^\d{14}$/.test(result.cnpj ?? ''))
    throw new Error('Informe --cnpj com 14 dígitos.');
  result.manifest ??= resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'data',
    `limpeza-nfe-transportador-${result.cnpj}.json`,
  );
  if (result.execute && result['resume-r2'])
    throw new Error('Escolha apenas --execute ou --resume-r2.');
  return result;
}

function findInfNFe(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.infNFe) return value.infNFe;
  for (const child of Object.values(value)) {
    const found = findInfNFe(child);
    if (found) return found;
  }
  return null;
}

function transportadorCnpj(xml) {
  return xmlIdentity(xml).transportador;
}

function xmlIdentity(xml) {
  const parsed = parser.parse(xml);
  const inf = findInfNFe(parsed);
  return {
    chave: String(inf?.['@_Id'] ?? '').replace(/^NFe/, ''),
    emitente: digits(inf?.emit?.CNPJ ?? inf?.emit?.CPF),
    destinatario: digits(inf?.dest?.CNPJ ?? inf?.dest?.CPF),
    transportador: digits(inf?.transp?.transporta?.CNPJ),
  };
}

function isMissing(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    ['NoSuchKey', 'NotFound'].includes(error?.name)
  );
}

function docSnapshot(row) {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    chave: row.chave_acesso,
    nsu: String(row.nsu),
    emitente: digits(row.emitente_cnpj_cpf),
    destinatario: digits(row.destinatario_cnpj_cpf),
    dataEmissao: row.data_emissao.toISOString(),
    xmlKey: row.xml_key,
    danfeKey: row.danfe_key,
    escriturado: row.escriturado,
  };
}

function sameRows(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function manifestDigest(manifest) {
  const fixed = {
    source: manifest.source,
    cnpj: manifest.cnpj,
    database: manifest.database,
    dbHost: manifest.dbHost,
    bucket: manifest.bucket,
    accountId: manifest.accountId,
    candidates: manifest.candidates,
    documents: manifest.documents,
    excluded: manifest.excluded,
    itens: manifest.itens,
  };
  return createHash('sha256').update(JSON.stringify(fixed)).digest('hex');
}

function journalDigest(manifest) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        manifest.digest,
        manifest.phase,
        manifest.pendingR2,
        manifest.completedR2,
      ]),
    )
    .digest('hex');
}

async function saveManifest(path, manifest, create = false) {
  manifest.journalDigest = journalDigest(manifest);
  await atomicSave(path, manifest, create);
}

async function atomicSave(path, value, create = false) {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  if (create) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return;
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

async function identity(db) {
  const [row] =
    await db`select current_database() as name, current_user as usuario`;
  return row;
}

async function candidates(db, cnpj, lock = false) {
  const [cliente] =
    await db`select id, cnpj, razao_social from clientes where cnpj = ${cnpj}`;
  if (!cliente) throw new Error(`Cliente ${cnpj} não encontrado.`);
  const rows = lock
    ? await db`select d.* from documentos_fiscais d where d.cliente_id = ${cliente.id} and d.tipo_documento = 'NFE' and d.modelo = '55' and d.nsu > 0 order by d.id for update`
    : await db`select d.* from documentos_fiscais d where d.cliente_id = ${cliente.id} and d.tipo_documento = 'NFE' and d.modelo = '55' and d.nsu > 0 order by d.id`;
  const invalid = rows.filter(
    (row) =>
      digits(row.emitente_cnpj_cpf) !== cnpj &&
      digits(row.destinatario_cnpj_cpf) !== cnpj,
  );
  return { cliente, rows: invalid.map(docSnapshot) };
}

async function xmlRole(r2, bucket, key) {
  try {
    const response = await r2.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`XML sem corpo: ${key}`);
    const buffer = Buffer.from(await response.Body.transformToByteArray());
    if (buffer.length > 10 * 1024 * 1024)
      throw new Error(`XML maior que 10 MB: ${key}`);
    return { status: 'presente', ...xmlIdentity(buffer.toString('utf8')) };
  } catch (error) {
    if (isMissing(error)) return { status: 'ausente', transportador: '' };
    throw error;
  }
}

function assertTarget(identityRow, args, bucket) {
  if (
    (args['expect-database'] && identityRow.name !== args['expect-database']) ||
    (args['expect-bucket'] && bucket !== args['expect-bucket'])
  ) {
    throw new Error(
      `Destino divergente: banco=${identityRow.name}, bucket=${bucket}.`,
    );
  }
}

function assertXmlMatchesDocument(document, role, cnpj) {
  if (role.status === 'ausente') return;
  if (
    role.transportador !== cnpj ||
    role.chave !== document.chave ||
    role.emitente !== document.emitente ||
    role.destinatario !== document.destinatario
  ) {
    throw new Error(
      `XML da chave ${document.chave} não confere com o documento ou transportador.`,
    );
  }
}

function assertManifest(
  manifest,
  args,
  identityRow,
  bucket,
  accountId,
  dbHost,
) {
  if (
    manifest.source !== SOURCE ||
    manifest.cnpj !== args.cnpj ||
    manifest.database !== identityRow.name ||
    manifest.dbHost !== dbHost ||
    manifest.bucket !== bucket ||
    manifest.accountId !== accountId ||
    !Array.isArray(manifest.candidates) ||
    !Array.isArray(manifest.documents) ||
    !Array.isArray(manifest.pendingR2) ||
    !Array.isArray(manifest.completedR2)
  ) {
    throw new Error('Manifesto inválido ou referente a outro destino.');
  }
  if (manifest.digest !== manifestDigest(manifest))
    throw new Error('Conteúdo do manifesto foi alterado.');
  if (manifest.journalDigest !== journalDigest(manifest))
    throw new Error('Estado do manifesto foi alterado.');
  const allowedKeys = new Set(
    manifest.documents.flatMap((doc) =>
      [doc.xmlKey, doc.danfeKey].filter(Boolean),
    ),
  );
  const allKeys = [...manifest.pendingR2, ...manifest.completedR2];
  if (
    allKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !key.startsWith(`clientes/${args.cnpj}/`) ||
        !allowedKeys.has(key),
    ) ||
    new Set(allKeys).size !== allKeys.length ||
    allKeys.length !== allowedKeys.size
  ) {
    throw new Error('Manifesto contém chaves R2 inválidas ou duplicadas.');
  }
}

async function checkDependencies(tx, document, cnpj) {
  const id = document.id;
  const [related] = await tx`
    select
      (select count(*) from documentos_fiscais_itens where documento_fiscal_id = ${id})::int as itens,
      (select count(*) from eventos_fiscais where documento_fiscal_id = ${id})::int as eventos,
      (select count(*) from documentos_fiscais_cte_escrituracao where documento_fiscal_id = ${id})::int as cte_escrituracao,
      (select count(*) from fiscal_decisoes_item f join documentos_fiscais_itens i on i.id = f.item_id where i.documento_fiscal_id = ${id})::int as decisoes,
      (select count(*) from classificacao_destinacao_aprendizado a join documentos_fiscais_itens i on i.id = a.item_id where i.documento_fiscal_id = ${id})::int as aprendizados,
      (select count(*) from ciap_ativo_permanente a where a.documento_fiscal_id = ${id} or a.documento_fiscal_item_id in (select id from documentos_fiscais_itens where documento_fiscal_id = ${id}))::int as ativos,
      (select count(*) from ciap_movimentos m where m.documento_fiscal_id = ${id} or m.documento_fiscal_item_id in (select id from documentos_fiscais_itens where documento_fiscal_id = ${id}))::int as movimentos,
      (select count(*) from sped_participantes where fonte_ultimo_documento_id = ${id})::int as participantes,
      (select count(*) from fiscal_fechamentos f join documentos_fiscais d on d.id = ${id} where f.cliente_id = d.cliente_id and
        (f.competencia = date_trunc('month', d.data_emissao)::date or f.competencia = date_trunc('month', d.data_emissao_fiscal)::date or
         f.competencia = date_trunc('month', d.data_entrada_saida)::date or f.competencia = date_trunc('month', d.data_entrada_saida_fiscal)::date))::int as fechamentos,
      (select count(*) from fiscal_entregas e join documentos_fiscais d on d.id = ${id} where e.cliente_id = d.cliente_id and
        (e.competencia = date_trunc('month', d.data_emissao)::date or e.competencia = date_trunc('month', d.data_emissao_fiscal)::date or
         e.competencia = date_trunc('month', d.data_entrada_saida)::date or e.competencia = date_trunc('month', d.data_entrada_saida_fiscal)::date))::int as entregas
  `;
  const { itens, ...blocked } = related;
  if (Object.values(blocked).some((count) => count > 0)) {
    throw new Error(
      `Documento ${document.chave} possui vínculos fiscais: ${JSON.stringify(blocked)}.`,
    );
  }
  for (const key of [document.xmlKey, document.danfeKey].filter(Boolean)) {
    if (!key.startsWith(`clientes/${cnpj}/`))
      throw new Error(`Chave R2 fora do cliente: ${key}`);
    const references =
      await tx`select id from documentos_fiscais where (xml_key = ${key} or danfe_key = ${key}) and id <> ${id} limit 1`;
    if (references.length) throw new Error(`Objeto R2 compartilhado: ${key}`);
  }
  return itens;
}

async function preview(db, r2, args, identityRow, bucket, accountId, dbHost) {
  const { cliente, rows } = await candidates(db, args.cnpj);
  const documents = [];
  const excluded = [];
  for (const document of rows) {
    if (!document.xmlKey.startsWith(`clientes/${args.cnpj}/`))
      throw new Error(`XML fora do cliente: ${document.xmlKey}`);
    const role = await xmlRole(r2, bucket, document.xmlKey);
    if (role.transportador === args.cnpj || role.status === 'ausente') {
      assertXmlMatchesDocument(document, role, args.cnpj);
      documents.push({
        ...document,
        xmlStatus: role.status,
        transportador: role.transportador,
      });
    } else {
      excluded.push({
        chave: document.chave,
        transportador: role.transportador,
        motivo: 'XML não identifica o cliente como transportador',
      });
    }
  }
  let itens = 0;
  for (const document of documents)
    itens += await checkDependencies(db, document, args.cnpj);
  const keys = [
    ...new Set(
      documents.flatMap((doc) => [doc.xmlKey, doc.danfeKey].filter(Boolean)),
    ),
  ];
  const manifest = {
    source: SOURCE,
    criadoEm: new Date().toISOString(),
    phase: 'PREVIEW',
    cnpj: args.cnpj,
    cliente: cliente.razao_social,
    database: identityRow.name,
    dbHost,
    dbUser: identityRow.usuario,
    bucket,
    accountId,
    candidates: rows,
    documents,
    excluded,
    itens,
    pendingR2: keys,
    completedR2: [],
  };
  manifest.digest = manifestDigest(manifest);
  let previous;
  try {
    previous = JSON.parse(await readFile(args.manifest, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (previous) {
    if (previous.phase !== 'PREVIEW')
      throw new Error(
        `Manifesto existente na fase ${previous.phase}; use --resume-r2 ou outro caminho com --manifest.`,
      );
    const sameTarget =
      previous.source === SOURCE &&
      previous.cnpj === args.cnpj &&
      previous.database === identityRow.name &&
      previous.dbHost === dbHost &&
      previous.bucket === bucket &&
      previous.accountId === accountId;
    if (
      sameTarget &&
      previous.documents?.some((doc) => !rows.some((row) => row.id === doc.id))
    ) {
      throw new Error(
        'Documento da prévia anterior já não existe no banco. Preserve o manifesto e use --resume-r2 ou investigue a limpeza antes de gerar nova prévia.',
      );
    }
    let invalid = !sameTarget;
    if (sameTarget) {
      try {
        assertManifest(previous, args, identityRow, bucket, accountId, dbHost);
      } catch {
        invalid = true;
      }
    }
    if (invalid) {
      const archived = `${args.manifest}.anterior-${randomUUID()}`;
      await rename(args.manifest, archived);
      console.warn(`Prévia anterior preservada em ${archived}.`);
      previous = null;
    }
  }
  await saveManifest(args.manifest, manifest, !previous);
  const xmlsAusentes = documents.filter(
    (document) => document.xmlStatus === 'ausente',
  ).length;
  console.log(
    JSON.stringify(
      {
        manifest: args.manifest,
        fase: manifest.phase,
        banco: manifest.database,
        bucket,
        candidatos: rows.length,
        selecionados: documents.length,
        xmlsAusentes,
        itens,
        excluidosDaSelecao: excluded,
        chavesR2: keys.length,
        documentos: documents.map(({ chave, xmlStatus, escriturado }) => ({
          chave,
          xmlStatus,
          escriturado,
        })),
      },
      null,
      2,
    ),
  );
  if (documents.length > 0 && xmlsAusentes === documents.length) {
    console.warn(
      `Atenção: todos os XMLs selecionados estão ausentes do bucket ${bucket}. Confira se R2_BUCKET_NAME aponta para o bucket correto antes de executar.`,
    );
  }
}

async function deleteR2(db, r2, args, manifest) {
  const { rows } = await candidates(db, args.cnpj);
  if (manifest.documents.some((doc) => rows.some((row) => row.id === doc.id))) {
    throw new Error(
      'Há documentos do manifesto ainda no banco; R2 não será apagado.',
    );
  }
  const failed = [];
  for (const key of [...manifest.pendingR2]) {
    try {
      const references =
        await db`select id from documentos_fiscais where xml_key = ${key} or danfe_key = ${key} limit 1`;
      if (references.length)
        throw new Error('Objeto voltou a ser referenciado no banco.');
      await r2.send(
        new DeleteObjectCommand({ Bucket: manifest.bucket, Key: key }),
      );
      try {
        await r2.send(
          new HeadObjectCommand({ Bucket: manifest.bucket, Key: key }),
        );
        throw new Error('Objeto ainda presente após exclusão.');
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      manifest.pendingR2 = manifest.pendingR2.filter(
        (candidate) => candidate !== key,
      );
      manifest.completedR2.push(key);
      await saveManifest(args.manifest, manifest);
    } catch (error) {
      failed.push({ key, erro: error.message });
    }
  }
  manifest.phase = manifest.pendingR2.length ? 'R2_INCOMPLETE' : 'COMPLETE';
  await saveManifest(args.manifest, manifest);
  console.log(
    JSON.stringify(
      {
        fase: manifest.phase,
        documentosApagados: manifest.documents.length,
        chavesPendentesR2: manifest.pendingR2,
        falhas: failed,
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 2;
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  const bucket = process.env.R2_BUCKET_NAME;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (
    !url ||
    !bucket ||
    !accountId ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'Configure DATABASE_URL e R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
    );
  }
  const dbHost = new URL(url).host;
  const db = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5 });
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  try {
    const identityRow = await identity(db);
    assertTarget(identityRow, args, bucket);
    if (!args.execute && !args['resume-r2']) {
      await preview(db, r2, args, identityRow, bucket, accountId, dbHost);
      return;
    }
    const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
    assertManifest(manifest, args, identityRow, bucket, accountId, dbHost);
    if (args.execute) {
      if (manifest.phase !== 'PREVIEW')
        throw new Error(
          `Manifesto na fase ${manifest.phase}; use --resume-r2 se o banco já foi limpo.`,
        );
      if (!manifest.documents.length)
        throw new Error('Manifesto não contém documentos selecionados.');
      for (const document of manifest.documents) {
        const role = await xmlRole(r2, bucket, document.xmlKey);
        assertXmlMatchesDocument(document, role, args.cnpj);
      }
      await db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`cleanup-nfe-transportador:${args.cnpj}`}, 0))`;
        const current = await candidates(tx, args.cnpj, true);
        if (!sameRows(current.rows, manifest.candidates))
          throw new Error(
            'Candidatos mudaram desde a prévia. Gere outro manifesto.',
          );
        const selected = new Set(manifest.documents.map((doc) => doc.id));
        if (selected.size !== manifest.documents.length)
          throw new Error('IDs duplicados no manifesto.');
        const expectedKeys = [
          ...new Set(
            manifest.documents.flatMap((doc) =>
              [doc.xmlKey, doc.danfeKey].filter(Boolean),
            ),
          ),
        ];
        if (!sameRows(expectedKeys, [...new Set(manifest.pendingR2)]))
          throw new Error('Chaves R2 do manifesto foram alteradas.');
        for (const document of manifest.documents) {
          const actual = current.rows.find((row) => row.id === document.id);
          if (!actual)
            throw new Error(`Documento não elegível: ${document.id}`);
          if (
            !sameRows(
              actual,
              Object.fromEntries(
                Object.entries(actual).map(([key]) => [key, document[key]]),
              ),
            )
          ) {
            throw new Error(
              `Dados do documento no manifesto foram alterados: ${document.chave}`,
            );
          }
          await checkDependencies(tx, document, args.cnpj);
        }
        for (const document of manifest.documents) {
          const removed =
            await tx`delete from documentos_fiscais where id = ${document.id} and cliente_id = ${document.clienteId} returning id`;
          if (removed.length !== 1)
            throw new Error(`Documento mudou: ${document.chave}`);
        }
      });
      manifest.phase = 'DB_DELETED';
      await saveManifest(args.manifest, manifest);
    } else if (
      !['PREVIEW', 'DB_DELETED', 'R2_INCOMPLETE'].includes(manifest.phase)
    ) {
      throw new Error(
        `Manifesto na fase ${manifest.phase}; não há pendências.`,
      );
    }
    await deleteR2(db, r2, args, manifest);
  } finally {
    await db.end();
    r2.destroy();
  }
}

if (process.argv[1]?.endsWith('cleanup-nfe-transportador-r2.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  argsFrom,
  transportadorCnpj,
  docSnapshot,
  sameRows,
  checkDependencies,
};
