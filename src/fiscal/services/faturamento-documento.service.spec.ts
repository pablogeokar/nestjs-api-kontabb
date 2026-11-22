import { FaturamentoDocumentoService } from './faturamento-documento.service';
import {
  montarMesesFaturamento,
  parseFaturamentoPeriod,
} from './faturamento.service';
import type { ReceitaBrutaCompetencia } from './simples-nacional.service';

function paginas(pdf: Buffer) {
  return (pdf.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}

type Valores = Partial<
  Pick<
    ReceitaBrutaCompetencia,
    | 'mercadorias'
    | 'servicos'
    | 'transportes'
    | 'devolucoes'
    | 'origem'
    | 'detalhado'
    | 'receitaBruta'
  >
>;

const centavos = (valor?: string) => Math.round(Number(valor ?? '0') * 100);

function periodo(
  inicio: string,
  fim: string,
  receita: (indice: number) => Valores,
) {
  const p = parseFaturamentoPeriod(inicio, fim);
  const receitas: ReceitaBrutaCompetencia[] = [];
  for (let offset = p.first; offset <= p.last; offset++) {
    const v = receita(offset - p.first);
    const calculado =
      centavos(v.mercadorias) +
      centavos(v.servicos) +
      centavos(v.transportes) -
      centavos(v.devolucoes);
    receitas.push({
      competencia: `${Math.floor(offset / 12)}-${String((offset % 12) + 1).padStart(2, '0')}`,
      origem: v.origem ?? 'DOCUMENTOS',
      statusApuracao: null,
      detalhado: v.detalhado ?? true,
      mercadorias: v.mercadorias ?? '0.00',
      servicos: v.servicos ?? '0.00',
      transportes: v.transportes ?? '0.00',
      devolucoes: v.devolucoes ?? '0.00',
      receitaBruta: v.receitaBruta ?? (calculado / 100).toFixed(2),
    });
  }
  return { inicio, fim, ...montarMesesFaturamento(receitas) };
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
    const dados = periodo('2026-08', '2026-10', (i) => ({
      transportes: String(40000 + i),
    }));
    const pdf = await service.render({ ...base, ...dados });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(paginas(pdf)).toBe(1);
  });

  it('segue para uma segunda página quando o relatório de 12 meses não cabe em uma', async () => {
    const dados = periodo('2025-11', '2026-10', (i) => ({
      mercadorias: String(100000 + i * 10),
      servicos: '3206.00',
      devolucoes: i % 4 === 0 ? '902.00' : '0.00',
    }));
    expect(paginas(await service.render({ ...base, ...dados }))).toBe(2);
  });

  it('pagina um período de 120 competências sem perder linhas nem criar páginas vazias', async () => {
    const dados = periodo('2017-01', '2026-12', () => ({
      mercadorias: '55798.60',
    }));
    const n = paginas(await service.render({ ...base, ...dados }));
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('emite período com devoluções e com mês do histórico informado', async () => {
    const dados = periodo('2026-01', '2026-03', (i) =>
      i === 0
        ? {
            origem: 'HISTORICO_INFORMADO',
            detalhado: false,
            receitaBruta: '61215.50',
          }
        : { mercadorias: '54129.00', devolucoes: '4135.00' },
    );
    expect(dados.total).toBe('161203.50');
    const pdf = await service.render({ ...base, ...dados });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Critérios e assinatura seguem juntos para a página seguinte quando não cabem.
    expect(paginas(pdf)).toBeLessThanOrEqual(2);
  });

  it('emite período sem movimento e responsável não vinculado, sem falhar', async () => {
    const dados = periodo('2026-10', '2026-10', () => ({}));
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
    const dados = periodo('2026-10', '2026-10', () => ({ servicos: '100.00' }));
    const semAssinatura = await service.render({ ...base, ...dados });
    const comAssinatura = await service.render({
      ...base,
      ...dados,
      assinado: true,
    });
    expect(semAssinatura.toString('latin1')).not.toContain('/ByteRange');
    expect(comAssinatura.toString('latin1')).toContain('/ByteRange');
  });

  it('embute o endereço de verificação com o código de controle como link', async () => {
    const dados = periodo('2026-10', '2026-10', () => ({}));
    const pdf = (await service.render({ ...base, ...dados })).toString(
      'latin1',
    );
    expect(pdf).toContain(
      'https://kontabb.com.br/verificar-faturamento?codigo=KTB-A1B2C3D4E5F60718293A4B5C6D7E8F90',
    );
  });
});
