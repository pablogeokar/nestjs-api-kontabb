# EFD ICMS/IPI (SPED Fiscal)

## Escopo normativo

O gerador atende competências de **2026** com:

- `COD_VER 020` (leiaute 119);
- Guia Prático EFD ICMS/IPI 3.2.2;
- arquivo em ISO-8859-1, linhas CRLF e campos delimitados por `|`;
- referência operacional ao PVA 6.1.1.

A competência define o leiaute. O sistema bloqueia períodos fora de 2026 para
evitar a emissão silenciosa com uma versão incompatível. O Guia 3.2.3 e o
`COD_VER 021` têm vigência a partir de 2027 e exigirão implementação própria.

Referências oficiais:

- [Guia Prático 3.2.2](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi/manuais-e-documentos-tecnicos/guia-pratico-da-efd-icms-ipi-3-2.2)
- [Nota Técnica 2025.001 — leiaute 020/119](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/06___anexo_2.pdf/@@download/file/06___ANEXO_2.pdf)
- [PVA 6.1.1](https://www.gov.br/sped/pt-br/assuntos/comunicados/efd-icms-ipi/publicacao-do-programa-efd-icms-ipi-versao-6-1.1)
- [CNPJ alfanumérico — Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico)

## Blocos e documentos suportados

O arquivo sempre contém os shells dos blocos na ordem oficial
`0, B, C, D, E, G, H, K, 1, 9`.

- Bloco 0: `0000`, `0002` quando industrial, `0005`, `0100`, `0150`, `0190`,
  `0200` e `0450`.
- Bloco C: NF-e 55 e NFC-e 65 em `C100`, `C101`, `C110`, `C170` conforme
  perfil/modelo/emissão e `C190` por documento.
- Bloco D: CT-e 57 escriturável em `D100` e `D190` por documento.
- Bloco E: ICMS próprio (`E100/E110/E111/E116`), ICMS-ST
  (`E200/E210/E250`), DIFAL/FCP (`E300/E310/E316`) e IPI para estabelecimento
  industrial (`E500/E510/E520/E530`).
- Bloco H: `H005/H010` para inventário fechado e motivo `01`.
- Bloco 1: `1010` com os 13 indicadores do leiaute.
- Bloco 9: totalizadores `9900`, `9990` e `9999` calculados depois de todos os
  demais registros.

Os valores de PIS e COFINS do XML são informados nos campos documentais que os
exigem, mas **não são apurados** nesta escrituração. A apuração desses tributos
pertence à EFD-Contribuições.

## Regras de segurança fiscal

- Documentos denegados não são emitidos, pois `COD_SIT 04/05` foi
  descontinuado no leiaute 2026.
- XML resumido, documento pendente, CFOP não revisado ou integridade divergente
  bloqueiam a geração.
- A integridade compara contagem e totais homólogos dos itens com `ICMSTot`, sem
  comparar incorretamente `vNF` com a soma de `vProd`. A tolerância interna é
  R$ 0,02.
- Crédito automático de ICMS de entrada fica limitado aos CST 00/10/20/70 e ao
  crédito destacado dos CSOSN 101/201. Situações ambíguas são bloqueadas para
  revisão humana.
- Simples Nacional só pode gerar quando a configuração afirmar obrigação
  estadual. Nesse caso, `E100/E110` são emitidos zerados; o bloco de apuração não
  é omitido.
- Perfil A/B/C vem da configuração estadual do estabelecimento, nunca do pedido
  de geração.
- O Bloco H anual só é exigido na competência definida em
  `mesEntregaInventario` (fevereiro por padrão). Nas demais competências, a
  configuração anual não bloqueia a geração.
- A data fiscal (`YYYY-MM-DD`) é preservada separadamente do instante do XML,
  evitando deslocamento de competência por fuso horário.
- CNPJ e chaves de acesso aceitam o formato alfanumérico previsto para o novo
  CNPJ. O cadastro e a leitura do certificado A1 também aceitam as 12 primeiras
  posições alfanuméricas e mantêm os dois dígitos verificadores numéricos.

## Fluxo operacional

1. Aplique a migration gerada pelo Drizzle:

   ```bash
   pnpm drizzle-kit migrate
   ```

2. Reprocesse os XMLs já armazenados para preencher totais, participantes,
   data fiscal e conferência de integridade:

   ```http
   POST /api/admin/fiscal/reprocessar-escrituracao
   Content-Type: application/json

   {
     "clienteId": "UUID",
     "dataInicio": "2026-08-01",
     "dataFim": "2026-08-31"
   }
   ```

   `documentosComFalhaIntegridade` deve ser zero antes de prosseguir.

3. Preencha a configuração do estabelecimento e do contabilista pela interface
   web ou pelos endpoints:

   - cliente: `GET/PUT /api/fiscal/sped/configuracao`;
   - admin: `GET/PUT /api/admin/fiscal/sped/configuracao`.

   Quando `inventarioObrigatorio` estiver ativo, confirme também
   `mesEntregaInventario` entre 1 e 12. O valor padrão é `2` (fevereiro).

4. Informe saldos anteriores, ajustes, obrigações e responsabilidades por UF:

   - cliente: `GET/PUT /api/fiscal/sped/contexto-apuracao`;
   - admin: `GET/PUT /api/admin/fiscal/sped/contexto-apuracao`.

   Use `E111` para ICMS próprio, `E220` para ICMS-ST por UF, `E311` para
   DIFAL/FCP por UF e `E530` para IPI. O indicador
   `DEBITO_ESPECIAL` corresponde à natureza `5` do código estadual. FCP próprio
   e FCP-ST precisam ser conciliados com ajustes de débito dedicados antes da
   geração.

5. Na competência configurada para o Bloco H, cadastre e feche o inventário
   pela interface web ou pelos endpoints:

   - cliente: `GET/PUT /api/fiscal/sped/inventario?data=YYYY-MM-DD`;
   - admin:
     `GET/PUT /api/admin/fiscal/sped/inventario?clienteId=UUID&data=YYYY-MM-DD`.

   Exemplo mínimo com estoque próprio:

   ```json
   {
     "motivo": "01",
     "valorTotal": "129.63",
     "status": "FECHADO",
     "participantes": [],
     "itens": [
       {
         "codigoExterno": "SKU-0001",
         "descricao": "Mercadoria para revenda",
         "unidade": "UN",
         "descricaoUnidade": "Unidade",
         "tipoItem": "00",
         "ncm": "22030000",
         "quantidade": "10.500",
         "valorUnitario": "12.345679",
         "valorItem": "129.63",
         "indicadorPropriedade": "0",
         "codigoConta": "1.1.3.01"
       }
     ]
   }
   ```

   Quantidade admite até 3 casas, valor unitário até 6 e os valores do item e
   do inventário precisam fechar exatamente. Para indicadores de propriedade
   `1` ou `2`, informe `participanteDocumento` no item e os dados completos do
   participante no array `participantes`. Perfis A e B exigem `codigoConta` ao
   fechar. Inventário sem estoque é fechado com `valorTotal: "0.00"` e sem
   itens. Motivos 02 a 06 ficam restritos a rascunho enquanto H020/H030 não
   estiverem implementados.

6. Consulte a prévia. Ela apresenta contadores, apuração e inconsistências
   impeditivas:

   ```http
   GET /api/fiscal/sped/efd-icms-ipi/preview?competencia=2026-08&finalidade=0
   ```

7. Gere somente quando `podeGerar` for `true`:

   ```http
   POST /api/fiscal/sped/efd-icms-ipi/gerar
   Content-Type: application/json

   { "competencia": "2026-08", "finalidade": "0" }
   ```

O download retorna bytes Latin-1. A geração usa snapshot transacional com lock
por empresa/competência, grava status, hash SHA-256, contadores e inconsistências
em `sped_arquivos_gerados` e armazena o TXT no bucket fiscal.

## Validação e liberação para entrega

Execute antes de publicar:

```bash
pnpm exec tsc --noEmit
pnpm exec jest --runInBand
pnpm lint
pnpm build
pnpm drizzle-kit check
```

A validação interna verifica encoding, CRLF, delimitadores, ordem dos blocos,
quantidade oficial de campos, shells e todos os totalizadores. Ela não substitui
o PVA oficial. Antes da primeira entrega de cada combinação UF/perfil/regime,
importe um arquivo de homologação no PVA 6.1.1 e registre o recibo/resultado da
validação operacional.

## Limitações impeditivas explícitas

O sistema bloqueia a geração, em vez de produzir arquivo incompleto, quando:

- a competência não é de 2026;
- o estabelecimento é do Distrito Federal e precisa de movimento no Bloco B;
- há obrigação de movimento no Bloco K;
- há inventário de motivo 02 a 06, que exige complementos H020/H030;
- FCP próprio ou FCP-ST depende de ajuste estadual ainda não configurado;
- há crédito, responsabilidade ou obrigação tributária ambígua.

Essas situações exigem implementação/configuração específica e validação com a
legislação da UF antes da liberação.
