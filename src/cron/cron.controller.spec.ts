import { UnauthorizedException } from '@nestjs/common';
import { CronController } from './cron.controller';

describe('CronController.runStorageCleanup', () => {
  const processJobs = jest.fn().mockResolvedValue({ processed: 2 });
  const cleanupExpired = jest.fn().mockResolvedValue(3);
  const logger = {
    generateRequestId: jest.fn().mockReturnValue('cron-request'),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
  const controller = new CronController(
    { processJobs } as never,
    {} as never,
    { get: jest.fn().mockReturnValue('secret') } as never,
    logger as never,
    { cleanupExpired } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    processJobs.mockResolvedValue({ processed: 2 });
    cleanupExpired.mockResolvedValue(3);
  });

  it('preserva o contrato GET e executa o expurgo após a limpeza de storage', async () => {
    await expect(
      controller.runStorageCleanup('Bearer secret'),
    ).resolves.toEqual({
      success: true,
      processed: 2,
    });
    expect(processJobs).toHaveBeenCalledWith(undefined, {
      requestId: 'cron-request',
      trigger: 'cron',
    });
    expect(cleanupExpired).toHaveBeenCalledTimes(1);
  });

  it('não executa o expurgo sem autorização', async () => {
    await expect(
      controller.runStorageCleanup('Bearer wrong'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processJobs).not.toHaveBeenCalled();
    expect(cleanupExpired).not.toHaveBeenCalled();
  });

  it('mantém a resposta do cron quando o expurgo falha', async () => {
    cleanupExpired.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      controller.runStorageCleanup('Bearer secret'),
    ).resolves.toEqual({
      success: true,
      processed: 2,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'rate_limit_cleanup_failed',
      expect.any(Error),
      expect.objectContaining({ requestId: 'cron-request' }),
    );
  });

  it('tenta o expurgo mesmo quando os jobs de storage falham', async () => {
    processJobs.mockRejectedValueOnce(
      new Error('storage database unavailable'),
    );
    await expect(controller.runStorageCleanup('Bearer secret')).rejects.toThrow(
      'storage database unavailable',
    );
    expect(cleanupExpired).toHaveBeenCalledTimes(1);
  });
});
