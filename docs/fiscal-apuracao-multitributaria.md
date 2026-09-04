# Apuração multitributária

Serviços de apuração que consomem os documentos escriturados e as tabelas de
apoio para produzir demonstrativos por competência. Todos os valores trafegam
como string decimal (numeric) e a competência usa o formato `AAAA-MM`.

## CIAP (Bloco G — crédito do ativo permanente)

Base legal: LC 87/96, art. 20, §5º. O crédito de ICMS de bens do ativo é
apropriado em **48 parcelas mensais** (1/48), cada parcela multiplicada pelo
**coeficiente de saídas tributadas** (saídas tributadas ÷ saídas totais do
período).

- `ciap_ativo_permanente` guarda a ficha de cada bem (valor de ICMS, parcelas
  apropriadas, saldo restante, status).
- `CiapService`:
  - `importarBensDoPeriodo`: cria fichas a partir de itens de compra de ativo
    (CFOP `x551`) escriturados;
  - `apurarCompetencia`: **preview** da parcela e do crédito do período (não
    persiste);
  - `apropriarCompetencia`: efetiva a apropriação (incrementa parcelas, reduz
    saldo, conclui na 48ª) e **gera automaticamente um ajuste `E111` de crédito**
    (`sped_ajustes_apuracao`, código `UF02CIAP`) que realimenta a apuração do
    ICMS no Bloco E da EFD;
  - `baixarBem`: baixa por venda/transferência.

## DIFAL de entrada

Base legal: CF/88 art. 155, §2º, VII. Compras interestaduais de uso/consumo
(`2556`) ou ativo (`2551`) exigem o diferencial de alíquota para a UF de destino.

`DifalEntradaService.apurarCompetencia` calcula, por item:
`DIFAL = base × (alíquota interna da UF do adquirente − alíquota interestadual)`.
A alíquota interna usa uma tabela por UF (fallback 18%); a interestadual vem do
item (fallback 12%). O DIFAL é somado por competência.

## PIS/COFINS

`PisCofinsService.apurarCompetencia` segrega a apuração por regime do cliente:

- **Simples Nacional**: recolhido via DAS — sem apuração destacada.
- **Lucro Presumido**: cumulativo, 0,65% (PIS) e 3,00% (COFINS) sobre a receita,
  sem créditos (Lei 9.718/98).
- **Lucro Real**: não-cumulativo, 1,65% e 7,60% com créditos das entradas (Leis
  10.637/02 e 10.833/03).

A receita é segregada por CST em tributada (`01/02`), monofásica/ST/alíquota zero
(`04–09`, sem débito próprio) e creditável (`50–56/60–66`), evitando tributar em
duplicidade. É a base para o Bloco M da EFD-Contribuições (geração do arquivo em
si é trabalho futuro).

## Guias de recolhimento

`fiscal_apuracoes_guias` armazena as guias (DAE/GNRE/DARF/DAS) por competência e
tributo. `FiscalGuiasService` oferece criar/listar/marcar pagamento/remover e um
resumo consolidado por competência. As guias hoje são criadas manualmente via
endpoint; a geração automática a partir das apurações é evolução planejada.

## Endpoints

Cliente (`/api/fiscal/apuracao/...`):

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/fiscal/apuracao/ciap?competencia=AAAA-MM` | Preview do CIAP |
| GET | `/fiscal/apuracao/ciap/bens?status=` | Bens do CIAP |
| GET | `/fiscal/apuracao/difal-entrada?competencia=AAAA-MM` | DIFAL de entrada |
| GET | `/fiscal/apuracao/pis-cofins?competencia=AAAA-MM` | PIS/COFINS |
| GET | `/fiscal/apuracao/guias?competencia=&tributo=&status=` | Guias |
| GET | `/fiscal/apuracao/guias/resumo?competencia=AAAA-MM` | Resumo de guias |

Admin/staff (`/api/admin/fiscal/apuracao/...`, escrita):

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/admin/fiscal/apuracao/ciap/importar` | Importar bens de ativo |
| POST | `/admin/fiscal/apuracao/ciap/bens` | Registrar bem manualmente |
| POST | `/admin/fiscal/apuracao/ciap/apropriar` | Efetivar 1/48 + ajuste E111 |
| PATCH | `/admin/fiscal/apuracao/ciap/bens/:id/baixa` | Baixar bem |
| POST | `/admin/fiscal/apuracao/guias` | Criar guia |
| PATCH | `/admin/fiscal/apuracao/guias/:id/pagamento` | Atualizar pagamento |
| DELETE | `/admin/fiscal/apuracao/guias/:id?clienteId=UUID` | Remover guia |

## Interface

- **Fiscal → Cockpit** (`/cliente/fiscal/cockpit`): cards de saúde fiscal
  (ICMS/PIS/COFINS/guias) com semáforo por competência.
- **Fiscal → Apuração** (`/cliente/fiscal/apuracao`): workspace em abas
  (ICMS, DIFAL, CIAP, PIS/COFINS, Guias) no estilo livro fiscal.

## Limitações atuais

- A geração do arquivo da EFD-Contribuições (Bloco M) não está implementada; o
  serviço de PIS/COFINS produz o demonstrativo, não o TXT.
- Guias são lançadas manualmente; não há emissão automática de DAE/GNRE.
- A tabela de alíquotas internas de ICMS por UF é uma referência modal e pode
  divergir de alíquotas específicas por NCM.
