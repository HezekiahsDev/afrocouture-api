import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { REDIS } from './common/redis/redis.module.js';

describe('AppController', () => {
  let appController: AppController;
  const dataSource = { query: vi.fn(async () => [{ '?column?': 1 }]) };
  const redis = { ping: vi.fn(async () => 'PONG') };
  const res = { status: vi.fn(), setHeader: vi.fn() };

  beforeEach(async () => {
    dataSource.query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockReset().mockResolvedValue('PONG');
    res.status.mockClear();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('is ok with 200 when Postgres and Redis answer', async () => {
      const health = await appController.getHealth(res as any);
      expect(health).toMatchObject({ status: 'ok', db: 'up', redis: 'up', service: 'afrocouture-api', version: '0.1.0' });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('is degraded with 503 when Redis is down', async () => {
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
      const health = await appController.getHealth(res as any);
      expect(health).toMatchObject({ status: 'degraded', db: 'up', redis: 'down' });
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('is degraded when the database hangs past the timeout', async () => {
      vi.useFakeTimers();
      dataSource.query.mockImplementation(() => new Promise(() => undefined));
      const pending = appController.getHealth(res as any);
      await vi.advanceTimersByTimeAsync(2100);
      const health = await pending;
      vi.useRealTimers();
      expect(health).toMatchObject({ status: 'degraded', db: 'down', redis: 'up' });
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
