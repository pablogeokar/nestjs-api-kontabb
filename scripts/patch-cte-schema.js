/**
 * Patches para @nfewizard/shared:
 *
 * 1. Remove validação de schema local para CT-e.
 *    O xsd-assembler/libxmljs2 não resolve corretamente o xs:include relativo
 *    no XSD de CT-e, causando "No matching global declaration" error.
 *    A SEFAZ valida o XML server-side, então a validação local é redundante.
 *
 * 2. Inclui os root certificates padrão do Node.js no https.Agent.
 *    A lib substitui os CAs do sistema ao passar `ca: [icpBrasilCerts]`.
 *    Isso causa "unable to get local issuer certificate" quando o webservice
 *    SEFAZ usa certificado SSL de CA global (DigiCert, Amazon, etc.).
 *    O fix inclui tls.rootCertificates junto com os ICP-Brasil.
 *
 * Ref: https://github.com/nfewizard-org/nfewizard-io (aguardando fix upstream)
 */
const fs = require('fs');
const path = require('path');

// Encontrar todas as instâncias do @nfewizard/shared no node_modules
function findSharedPackages(baseDir) {
  const pnpmDir = path.join(baseDir, 'node_modules', '.pnpm');
  const results = [];

  if (!fs.existsSync(pnpmDir)) return results;

  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('@nfewizard+shared@')) {
      const bundlePath = path.join(
        pnpmDir,
        entry.name,
        'node_modules',
        '@nfewizard',
        'shared',
        'dist',
        'index.mjs',
      );
      if (fs.existsSync(bundlePath)) {
        results.push(bundlePath);
      }
    }
  }

  // Também verificar em node_modules/.pnpm/node_modules/@nfewizard/shared
  const hoistedPath = path.join(
    pnpmDir,
    'node_modules',
    '@nfewizard',
    'shared',
    'dist',
    'index.mjs',
  );
  if (fs.existsSync(hoistedPath)) {
    results.push(hoistedPath);
  }

  return results;
}

function patchBundle(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // ─── Patch 1: Remover validação XSD para CTeDistribuicaoDFe ───────────────
  const schemaPattern =
    /CTeDistribuicaoDFe:\s*`\$\{pathSchemas\}\/cte\/distDFeInt_v1\.00\.xsd`/g;

  if (schemaPattern.test(content)) {
    content = content.replace(
      /CTeDistribuicaoDFe:\s*`\$\{pathSchemas\}\/cte\/distDFeInt_v1\.00\.xsd`/g,
      'CTeDistribuicaoDFe: undefined',
    );
    modified = true;
    console.log(`  [patch-1: schema] aplicado`);
  }

  // ─── Patch 2: Incluir root certificates do Node.js no https.Agent ─────────
  // Adicionar import de tls no topo do bundle se não existir
  if (
    !content.includes("import tls from 'tls'") &&
    !content.includes('import tls from "tls"')
  ) {
    // Adicionar import de tls logo após os outros imports do Node
    content = `import tls from 'tls';\n` + content;
    modified = true;
    console.log(`  [patch-2a: tls import] adicionado`);
  }

  // Substituir `agentOptions.ca = caCerts;` por incluir rootCertificates
  const caOriginal = 'agentOptions.ca = caCerts;';
  const caPatched =
    'agentOptions.ca = [...caCerts, ...(tls.rootCertificates || []).map(c => Buffer.from(c))];';

  if (content.includes(caOriginal)) {
    // Substituir TODAS as ocorrências
    content = content.split(caOriginal).join(caPatched);
    modified = true;
    console.log(`  [patch-2b: tls rootCerts] aplicado`);
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  console.log(
    `  [skip] ${path.relative(process.cwd(), filePath)} (já patcheado)`,
  );
  return false;
}

// Main
const baseDir = path.resolve(__dirname, '..');
console.log('Patching @nfewizard/shared...');

const bundles = findSharedPackages(baseDir);

if (bundles.length === 0) {
  console.log('  Nenhum bundle @nfewizard/shared encontrado. Pulando patch.');
  process.exit(0);
}

let patched = 0;
for (const bundle of bundles) {
  if (patchBundle(bundle)) {
    patched++;
  }
}

console.log(`Patch concluído. ${patched} arquivo(s) modificado(s).`);
