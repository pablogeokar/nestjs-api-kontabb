// Diagnóstico temporário: roda a emissão real com os serviços da aplicação e
// mostra o erro que o `catch` genérico de `emitir()` esconde. Apagar depois.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ContadorCertificadoService } from './cadastros/contadores/contador-certificado.service';
import { StorageService } from './storage/storage.service';
import { FaturamentoDocumentoService } from './fiscal/services/faturamento-documento.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const userId = process.argv[2];
  const passo = async <T>(nome: string, fn: () => Promise<T>) => {
    try {
      const r = await fn();
      console.log(`PASSO OK  ${nome}`);
      return r;
    } catch (e) {
      const err = e as Error & { code?: string; cause?: unknown };
      console.log(`PASSO FALHOU  ${nome}: ${err.name} | ${err.message}`);
      if (err.cause) console.log('  causa:', String((err.cause as Error).message ?? err.cause));
      if (err.stack) console.log(err.stack.split('\n').slice(0, 6).join('\n'));
      throw e;
    }
  };
  const certs = app.get(ContadorCertificadoService);
  const storage = app.get(StorageService);
  const pdf = app.get(FaturamentoDocumentoService);
  const contadorId = process.argv[3];
  try {
    const certificado = await passo('certificado do contador (getForSigning)', () =>
      certs.getForSigning(contadorId),
    );
    console.log('  certificado encontrado:', Boolean(certificado));
    const buffer = await passo('render do PDF', () =>
      pdf.render({
        numero: 'FAT-2026-999999', codigo: 'KTB-0123456789ABCDEF0123456789ABCDEF',
        nome: 'DIAGNOSTICO', documento: '69537189000152', contadorNome: 'X', contadorCrc: null,
        inicio: '2026-10', fim: '2026-10', emitidoEm: new Date(), assinado: Boolean(certificado),
        meses: [{ competencia: '2026-10', valorProdutos: '0.00', valorServicos: '0.00', valorTransportes: '1.00', total: '1.00', quantidadeProdutos: 0, quantidadeServicos: 0, quantidadeTransportes: 1 }],
        total: '1.00',
      }),
    );
    const key = `relatorios/faturamento/__diagnostico/${Date.now()}.pdf`;
    await passo('upload R2', () => storage.upload(key, buffer, 'application/pdf'));
    await passo('delete R2', () => storage.delete(key));
    console.log('userId informado:', userId);
  } catch {
    // já impresso
  } finally {
    await app.close();
  }
}
void main();
