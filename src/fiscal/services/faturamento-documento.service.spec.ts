import { FaturamentoDocumentoService } from './faturamento-documento.service';
import {
  buildFaturamentoMeses,
  parseFaturamentoPeriod,
} from './faturamento.service';

function paginas(pdf: Buffer) {
  return (pdf.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}
function periodo(
  inicio: string,
  fim: string,
  receita: (
    indice: number,
    competencia: string,
  ) => Parameters<typeof buildFaturamentoMeses>[2],
) {
  const p = parseFaturamentoPeriod(inicio, fim);
  const rows: Parameters<typeof buildFaturamentoMeses>[2] = [];
  for (let offset = p.first; offset <= p.last; offset++) {
    const competencia = `${Math.floor(offset / 12)}-${String((offset % 12) + 1).padStart(2, '0')}`;
    rows.push(...receita(offset - p.first, competencia));
  }
  return { inicio, fim, ...buildFaturamentoMeses(p.first, p.last, rows) };
}
const base = {
  numero: 'FAT-2026-000007',
  codigo: 'KTB-A1B2C3D4E5F60718293A4B5C6D7E8F90',
  nome: 'MINAS BAHIA CARGO LTDA',
  documento: '12345678000190',
  contadorNome: 'Fulano de Tal Borges',
  contadorCrc: 'BA-012345/O',
  emitidoEm: new Date('2026-11-22T17:32:00Z'),
  assinado: false,
};

describe('PDF da relação de faturamento', () => {
  const service = new FaturamentoDocumentoService();

  it('gera um PDF válido de uma página para uma transportadora, só com CT-e', async () => {
    const dados = periodo('2026-08', '2026-10', (i, competencia) => [
      {
        competencia,
        tipo: 'TRANSPORTE',
        valor: String(40000 + i),
        quantidade: 80,
      },
    ]);
    const pdf = await service.render({ ...base, ...dados });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(paginas(pdf)).toBe(1);
  });

  it('segue para uma segunda página quando o relatório de 12 meses não cabe em uma', async () => {
    const dados = periodo('2025-11', '2026-10', (i, competencia) => [
      {
        competencia,
        tipo: 'PRODUTO',
        valor: String(100000 + i * 10),
        quantidade: 60,
      },
      { competencia, tipo: 'SERVICO', valor: '3206.00', quantidade: 9 },
    ]);
    expect(paginas(await service.render({ ...base, ...dados }))).toBe(2);
  });

  it('pagina um período de 120 competências sem perder linhas nem criar páginas vazias', async () => {
    const dados = periodo('2017-01', '2026-12', (_i, competencia) => [
      { competencia, tipo: 'PRODUTO', valor: '55798.60', quantidade: 22 },
    ]);
    const n = paginas(await service.render({ ...base, ...dados }));
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('emite período sem movimento e responsável não vinculado, sem falhar', async () => {
    const dados = periodo('2026-10', '2026-10', () => []);
    const pdf = await service.render({
      ...base,
      ...dados,
      contadorNome: null,
      contadorCrc: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(pdf)).toBe(1);
  });

  it('reserva o espaço da assinatura digital apenas quando o documento será assinado', async () => {
    const dados = periodo('2026-10', '2026-10', (_i, competencia) => [
      { competencia, tipo: 'SERVICO', valor: '100.00', quantidade: 1 },
    ]);
    const semAssinatura = await service.render({ ...base, ...dados });
    const comAssinatura = await service.render({
      ...base,
      ...dados,
      assinado: true,
    });
    expect(semAssinatura.toString('latin1')).not.toContain('/ByteRange');
    expect(comAssinatura.toString('latin1')).toContain('/ByteRange');
  });

  it('embute o código de controle e o endereço de verificação como link', async () => {
    const dados = periodo('2026-10', '2026-10', () => []);
    const pdf = (await service.render({ ...base, ...dados })).toString(
      'latin1',
    );
    expect(pdf).toContain(
      'https://kontabb.com.br/verificar-faturamento?codigo=KTB-A1B2C3D4E5F60718293A4B5C6D7E8F90',
    );
  });
});
