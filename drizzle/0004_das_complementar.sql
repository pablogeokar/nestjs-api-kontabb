-- Migration: add DAS-COMPL to documentos.tipo CHECK constraint
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "chk_documentos_tipo";

ALTER TABLE "documentos" ADD CONSTRAINT "chk_documentos_tipo"
  CHECK ("tipo" IN ('FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO'));
