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
  `0200`, `0220` (fator de conversão de unidade, quando a unidade tributável
  diverge da comercial) e `0450`.
- Bloco C: NF-e 55 e NFC-e 65 em `C100`, `C101`, `C110`, `C113` (documentos
  referenciados em devolução/remessa, a partir do grupo `<NFref>`), `C170`
  conforme perfil/modelo/emissão e `C190` por documento.
- Bloco D: CT-e 57 escriturável em `D100` e `D190` por documento. O CT-e pode
  ser escriturado como **entrada** (cliente é o tomador) ou **saída** (cliente é
  o emitente/prestador do serviço de transporte).
- Bloco E: ICMS próprio (`E100/E110/E111/E116`), ICMS-ST
  (`E200/E210/E250`), DIFAL/FCP (`E300/E310/E316`) e IPI para estabelecimento
  industrial (`E500/E510/E520/E530`).
- Bloco G: `G110/G125` (CIAP) quando há bens do ativo em apropriação. O crédito
  de 1/48 apropriado no período realimenta a apuração do ICMS por um ajuste
  `E111` de crédito gerado automaticamente.
- Bloco H: `H005/H010` para inventário fechado e motivo `01`.
- Bloco 1: `1010` com os 13 indicadores do leiaute.
- Bloco 9: totalizadores `9900`, `9990` e `9999` calculados depois de todos os
  demais registros.

Os valores de PIS e COFINS do XML são informados nos campos documentais que os
exigem, mas **não são apurados nesta escrituração** (EFD ICMS/IPI). A apuração de
PIS/COFINS pertence à EFD-Contribuições e é oferecida em serviço próprio —
consulte `fiscal-apuracao-multitributaria.md`.

### Identificadores estáveis de participantes

O código do participante (registro `0150`) é reutilizado da tabela
`sped_participantes` quando o documento já foi visto em competências anteriores.
Só quando o participante ainda não existe é gerado um código determinístico por
hash. Isso preserva a continuidade histórica exigida pelo SPED entre meses, mesmo
que a razão social do fornecedor mude minimamente.

### Registros 0220 e C113

- **0220** é emitido subordinado ao `0200` quando o item traz unidade tributável
  diferente da comercial; o fator de conversão é `quantidadeTributavel /
quantidadeComercial`.
- **C113** é emitido subordinado ao `C100` quando o documento referencia outra
  nota (`<NFref>` com `refNFe`/`refCTe`). A captura ocorre no parser da NF-e e é
  persistida em `documentos_fiscais.documentos_referenciados`. Referências sem
  chave de acesso de 44 dígitos (NF modelo 1/1A, produtor rural) são
  armazenadas, mas não geram C113 por não possuírem `CHV_DOCe`.

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
  revisão humana. Além do CST, o **CFOP escriturado** veda o crédito quando a
  operação é de uso/consumo (`x556/x557/x407`), de mercadoria recebida como
  substituído (`x401/x403/x405/x406`) ou de ativo imobilizado (`x551/x552`, cujo
  crédito é apropriado via CIAP, não integral) — sem gerar falso positivo de
  revisão.
- O IPI apura débito na faixa de CST de saída (50) e crédito na faixa de entrada
  (00/01); os demais CSTs válidos não geram débito/crédito e não bloqueiam a
  geração. Apenas CSTs fora das faixas oficiais disparam revisão.
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
- Ajustes `E111/E220/E311/E530` sem descrição ou número de documento de suporte
  bloqueiam a geração. Obrigações informadas também são confrontadas com o
  saldo calculado, inclusive quando a apuração resulta em zero.

## Catálogo de contadores e registro 0100

O contador é uma entidade global do escritório na tabela `contadores`. O vínculo
fica em `clientes.contador_id`, portanto o mesmo profissional pode atender várias
empresas. O CRUD `/api/admin/cadastros/contadores` é exclusivo de staff e impede
a exclusão enquanto houver clientes vinculados.

A migration `0001_contadores_catalogo_sped.sql` copia os registros legados de
`sped_contabilistas`, deduplica por CPF/CNPJ + CRC e preenche o vínculo sem
apagar a origem. O conteúdo do registro 0100 permanece idêntico; muda somente a
fonte cadastral.

Na preparação da EFD, a resolução segue esta ordem:

1. contador explicitamente vinculado ao cliente;
2. único contador existente no catálogo global;
3. inconsistência impeditiva quando não há contador ou há várias opções sem
   vínculo.

A prévia retorna a origem (`VINCULO_EXPLICITO` ou `CONTADOR_UNICO`) para
auditoria. A escolha automática não grava uma hipótese escondida no cadastro e
continua permitindo que o staff defina outro contador depois.

## Inferências e trilha da apuração

Débitos e créditos seguros são calculados dos documentos escriturados, mantendo
as restrições de CST/CSOSN, regime, direção da operação e CT-e creditável. Saldos
anteriores, códigos de ajuste, obrigações e vencimentos estaduais não são
inventados: permanecem informados pelo responsável fiscal e são conciliados com
o cálculo automático.

O objeto `auditabilidade` da prévia separa cada fonte em
`DOCUMENTOS_ESCRITURADOS`, `INFORMADO` ou `PADRAO_ZERO`, com descrição e
fundamento. Assim, reduzir entrada manual não elimina a confirmação humana nas
decisões que dependem da legislação estadual ou de escrituração precedente.

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

3. Cadastre o contador em **Cadastros → Contadores**, vincule-o ao cliente e
   preencha a configuração do estabelecimento pela interface web ou endpoints:

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

6. Consulte a prévia. Ela apresenta contadores, apuração, origem dos valores e
   inconsistências impeditivas:

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

A validação interna tem duas camadas:

1. **Estrutural** (`validateSpedFile`): encoding, CRLF, delimitadores, ordem dos
   blocos, quantidade oficial de campos por registro (incluindo `0220`, `C113`,
   `G110`, `G125`), shells e todos os totalizadores.
2. **Semântica pré-PVA** (`runPreflightPva`): regras cruzadas do Guia Prático —
   `0150` completo, unidades/itens referenciados existentes nos catálogos
   (`0190`/`0200`), `C113` apontando participante do `0150`, aviso de devolução
   sem `C113` e parcela do CIAP dentro do limite de 48. As inconsistências pré-PVA
   entram na mesma lista `inconsistencias` da prévia (severidade `ERRO`/`AVISO`).

Nenhuma das camadas substitui o PVA oficial. Antes da primeira entrega de cada
combinação UF/perfil/regime, importe um arquivo de homologação no PVA 6.1.1 e
registre o recibo/resultado da validação operacional.

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

O Bloco G (CIAP) é populado a partir das fichas de `ciap_ativo_permanente`. A
apropriação da parcela (1/48) só é efetivada — e o ajuste `E111` de crédito
gerado — quando o usuário executa a apropriação da competência pelo serviço de
CIAP (ver `fiscal-apuracao-multitributaria.md`). Sem fichas ativas, o Bloco G
fica vazio e o arquivo permanece válido.
