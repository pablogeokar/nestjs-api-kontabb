-- Execute em uma branch/copia representativa do Neon antes de aplicar as
-- migrations. Todas as consultas devem retornar zero linhas.

-- Autenticacao
SELECT provider_id, account_id, count(*) AS quantidade
FROM account
GROUP BY provider_id, account_id
HAVING count(*) > 1;

SELECT user_id, provider_id, count(*) AS quantidade
FROM account
GROUP BY user_id, provider_id
HAVING count(*) > 1;

SELECT identifier, count(*) AS quantidade
FROM verification
GROUP BY identifier
HAVING count(*) > 1;

SELECT value, count(*) AS quantidade
FROM verification
GROUP BY value
HAVING count(*) > 1;

SELECT role, count(*)
FROM "user"
WHERE role NOT IN ('ADMIN', 'COLABORADOR', 'CLIENTE')
GROUP BY role;

-- Clientes
SELECT id, tipo_pessoa, cnpj, cpf
FROM clientes
WHERE NOT (
  (tipo_pessoa = 'PJ' AND cnpj ~ '^[0-9]{14}$' AND cpf IS NULL)
  OR
  (tipo_pessoa = 'PF' AND cnpj ~ '^[0-9]{11}$' AND cpf = cnpj)
);

SELECT user_id, count(*) AS quantidade
FROM clientes
WHERE user_id IS NOT NULL
GROUP BY user_id
HAVING count(*) > 1;

SELECT id, cep, uf, cnae_principal_codigo, cnaes_secundarios
FROM clientes
WHERE (cep IS NOT NULL AND cep !~ '^[0-9]{8}$')
   OR (uf IS NOT NULL AND uf !~ '^[A-Z]{2}$')
   OR (cnae_principal_codigo IS NOT NULL AND cnae_principal_codigo !~ '^[0-9]{7}$')
   OR jsonb_typeof(cnaes_secundarios) <> 'array';

-- Documentos
SELECT cliente_id, tipo, periodo, numero_parcelamento, count(*) AS quantidade
FROM documentos
GROUP BY cliente_id, tipo, periodo, numero_parcelamento
HAVING count(*) > 1;

SELECT tipo, count(*)
FROM documentos
WHERE tipo NOT IN (
  'FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS',
  'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR',
  'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO'
)
GROUP BY tipo;

SELECT status, count(*)
FROM documentos
WHERE status NOT IN ('PENDENTE', 'PAGO')
GROUP BY status;

SELECT email_status, count(*)
FROM documentos
WHERE email_status NOT IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')
GROUP BY email_status;

SELECT id, periodo, arquivo_key, arquivo_nome, valor, status, pago_em, numero_parcelamento
FROM documentos
WHERE periodo !~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
   OR arquivo_key IS NULL
   OR btrim(arquivo_key) = ''
   OR arquivo_nome IS NULL
   OR btrim(arquivo_nome) = ''
   OR valor < 0
   OR (status = 'PENDENTE' AND pago_em IS NOT NULL)
   OR (status = 'PAGO' AND pago_em IS NULL)
   OR (numero_parcelamento IS NOT NULL AND btrim(numero_parcelamento) = '');

-- RH
SELECT cliente_id, competencia, count(*) AS quantidade
FROM folhas_pagamento
GROUP BY cliente_id, competencia
HAVING count(*) > 1;

SELECT id, competencia, periodo_inicio, periodo_fim, arquivo_key, arquivo_nome
FROM folhas_pagamento
WHERE competencia !~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
   OR periodo_inicio > periodo_fim
   OR arquivo_key IS NULL
   OR btrim(arquivo_key) = ''
   OR arquivo_nome IS NULL
   OR btrim(arquivo_nome) = ''
   OR total_bruto < 0
   OR total_descontos < 0
   OR total_liquido < 0
   OR total_funcionarios < 0
   OR total_inss < 0
   OR total_fgts < 0
   OR total_irrf < 0
   OR total_salario_familia < 0;

SELECT id, codigo_funcionario, nome_completo, cpf
FROM funcionarios_rh
WHERE btrim(codigo_funcionario) = ''
   OR btrim(nome_completo) = ''
   OR (cpf IS NOT NULL AND cpf !~ '^[0-9]{11}$');

SELECT i.id, i.cliente_id, f.cliente_id AS cliente_folha,
       r.cliente_id AS cliente_funcionario
FROM itens_folha_pagamento i
JOIN folhas_pagamento f ON f.id = i.folha_id
JOIN funcionarios_rh r ON r.id = i.funcionario_id
WHERE i.cliente_id <> f.cliente_id
   OR i.cliente_id <> r.cliente_id;

SELECT id, dependentes_ir, dependentes_sf, rubricas
FROM itens_folha_pagamento
WHERE COALESCE(dependentes_ir, 0) < 0
   OR COALESCE(dependentes_sf, 0) < 0
   OR jsonb_typeof(rubricas) <> 'array';

-- Modulo fiscal
SELECT cliente_id, chave_acesso, count(*) AS quantidade
FROM documentos_fiscais
GROUP BY cliente_id, chave_acesso
HAVING count(*) > 1;

SELECT id, tipo_documento, modelo, chave_acesso
FROM documentos_fiscais
WHERE NOT (
  (tipo_documento = 'NFE' AND modelo = '55')
  OR (tipo_documento = 'CTE' AND modelo = '57')
  OR (tipo_documento = 'NFCE' AND modelo = '65')
);

-- Jobs operacionais
SELECT id, object_key, status, tentativas, concluido_em
FROM storage_cleanup_jobs
WHERE btrim(object_key) = ''
   OR tentativas < 0
   OR (status = 'CONCLUIDO' AND concluido_em IS NULL)
   OR (status <> 'CONCLUIDO' AND concluido_em IS NOT NULL);

SELECT key, count, reset_at
FROM app_rate_limits
WHERE count < 0 OR reset_at <= 0;
