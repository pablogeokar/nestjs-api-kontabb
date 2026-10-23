import { BadRequestException, Injectable } from '@nestjs/common';
import { ImportacaoChavesFiscalService } from './importacao-chaves-fiscal.service';
import { ImportacaoXmlFiscalService } from './importacao-xml-fiscal.service';
import { parseManualFiscalXml } from './dfe-document.parser';
import { isValidFiscalAccessKey } from './fiscal-identifier';

@Injectable()
export class RecuperacaoPortalService {
  constructor(
    private readonly chaves: ImportacaoChavesFiscalService,
    private readonly xml: ImportacaoXmlFiscalService,
  ) {}

  async preparar(clienteId: string, chaves: string[]) {
    const preview = await this.chaves.analisar({
      clienteId,
      chavesTexto: chaves.join('\n'),
    });
    if (preview.itens.some((item) => !item.valida || item.modelo !== '55')) {
      throw new BadRequestException(
        'A recuperação pelo portal aceita somente chaves válidas de NF-e modelo 55.',
      );
    }
    return {
      clienteId,
      chaves: preview.itens
        .filter((item) => item.status_local !== 'JA_IMPORTADA')
        .map((item) => item.chave_acesso),
      jaExistentes: preview.resumo.ja_existentes,
    };
  }

  async importar(input: {
    clienteId: string;
    chave: string;
    file: Express.Multer.File;
    actorUserId: string;
    requestId: string;
  }) {
    if (
      !input.file?.buffer?.length ||
      input.file.buffer.length > 10 * 1024 * 1024 ||
      !isValidFiscalAccessKey(input.chave)
    ) {
      throw new BadRequestException(
        'Envie um XML de até 10 MB e uma chave válida.',
      );
    }
    const xml = input.file.buffer.toString('utf8');
    const parsed = parseManualFiscalXml(xml);
    if (
      parsed.status !== 'DOCUMENTO' ||
      parsed.documento.tipoDocumento !== 'NFE' ||
      parsed.documento.chaveAcesso !== input.chave ||
      !/<(?:[\w]+:)?nfeProc[\s>]/.test(xml) ||
      !/<(?:[\w]+:)?Signature[\s>]/.test(xml)
    ) {
      throw new BadRequestException(
        'O arquivo deve ser o XML processado da NF-e da chave solicitada, com assinatura e protocolo.',
      );
    }
    // A importação existente valida participação da empresa, integridade e duplicidade.
    // A presença da assinatura não equivale à sua verificação criptográfica.
    return this.xml.importar({
      files: [input.file],
      clienteId: input.clienteId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
    });
  }
}
