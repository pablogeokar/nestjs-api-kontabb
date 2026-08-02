-- Execute em uma branch/cópia do Neon antes das migrations.

SELECT cliente_id, tipo, periodo, count(*) AS quantidade
FROM documentos
GROUP BY cliente_id, tipo, periodo
HAVING count(*) > 1;

SELECT role, count(*) FROM "user"
WHERE role NOT IN ('ADMIN', 'COLABORADOR', 'CLIENTE')
GROUP BY role;

SELECT tipo, count(*) FROM documentos
WHERE tipo NOT IN (
  'FGTS', 'DARF', 'DAS', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS',
  'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR',
  'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO'
)
GROUP BY tipo;

SELECT status, count(*) FROM documentos
WHERE status NOT IN ('PENDENTE', 'PAGO')
GROUP BY status;

SELECT email_status, count(*) FROM documentos
WHERE email_status NOT IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')
GROUP BY email_status;

SELECT user_id, count(*) AS quantidade
FROM clientes
WHERE user_id IS NOT NULL
GROUP BY user_id
HAVING count(*) > 1;

SELECT id, arquivo_key
FROM documentos
WHERE arquivo_key IS NULL OR btrim(arquivo_key) = '';
