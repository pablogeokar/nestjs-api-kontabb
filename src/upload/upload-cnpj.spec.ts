import { UploadController } from './upload.controller';

describe('UploadController: CNPJ manual', () => {
  it.each([
    ['12.345.678/0001-99', '12345678000199'],
    ['ab.12c.d34/ef56-78', 'AB12CD34EF5678'],
  ])('consulta o cliente com %s normalizado para %s', async (input, cnpj) => {
    const findClientForUpload = jest.fn().mockResolvedValue(undefined);
    const controller = new UploadController(
      {} as never,
      { findClientForUpload } as never,
      { generateRequestId: () => 'request-1' } as never,
      { consume: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const buffer = Buffer.from('%PDF-conteudo-invalido');
    const file = {
      buffer,
      size: buffer.length,
      mimetype: 'application/pdf',
      originalname: 'guia.pdf',
    } as Express.Multer.File;

    const result = await controller.upload([file], { cnpj: input }, {
      id: 'staff-1',
    } as never);

    expect(findClientForUpload).toHaveBeenCalledWith(cnpj);
    expect(result).toMatchObject({
      processed: 0,
      failed: 1,
      results: [{ cnpj, success: false }],
    });
  });
});
