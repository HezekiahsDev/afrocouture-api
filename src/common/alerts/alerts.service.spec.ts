import { ConfigService } from '@nestjs/config';
import { AlertsService } from './alerts.service.js';

function setup(env: Record<string, string>, redisSet: () => Promise<string | null> = async () => 'OK') {
  const mail = { sendMail: vi.fn(async () => ({ messageId: 'x' })) };
  const redis = { set: vi.fn(redisSet) };
  const service = new AlertsService(new ConfigService(env), mail as any, redis as any);
  return { service, mail, redis };
}

describe('AlertsService', () => {
  const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only logs when no destination is configured', async () => {
    const { service, mail, redis } = setup({});
    expect(service.enabled).toBe(false);
    expect(await service.send({ title: 'boom' })).toBe('logged');
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails every ALERT_EMAIL address and posts to the webhook', async () => {
    const { service, mail } = setup({
      ALERT_EMAIL: 'ops@example.com, dev@example.com',
      ALERT_WEBHOOK_URL: 'https://hooks.example.com/x',
      NODE_ENV: 'production',
    });
    expect(await service.send({ title: '500 on GET /orders/:id', details: 'TypeError: x' })).toBe('sent');
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    expect(mail.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@example.com', subject: '[AfroCouture production] 500 on GET /orders/:id' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/x');
    const body = JSON.parse(init.body as string) as { text: string; content: string };
    expect(body.text).toContain('TypeError: x');
    expect(body.content).toBe(body.text);
  });

  it('throttles repeats of the same signature with SET NX EX', async () => {
    let first = true;
    const { service, mail, redis } = setup({ ALERT_EMAIL: 'ops@example.com', ALERT_THROTTLE_MINUTES: '10' }, async () => {
      const result = first ? 'OK' : null;
      first = false;
      return result;
    });
    expect(await service.send({ title: 'a', signature: 'sig' })).toBe('sent');
    expect(await service.send({ title: 'a again', signature: 'sig' })).toBe('throttled');
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^alert:[0-9a-f]{40}$/), '1', 'EX', 600, 'NX');
  });

  it('fails open when Redis is down', async () => {
    const { service, mail } = setup({ ALERT_EMAIL: 'ops@example.com' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await service.send({ title: 'a' })).toBe('sent');
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('never throws when a destination fails', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 500 }));
    const { service, mail } = setup({ ALERT_EMAIL: 'ops@example.com', ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' });
    mail.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(service.send({ title: 'a' })).resolves.toBe('sent');
  });

  it('notify() returns immediately', () => {
    const { service } = setup({ ALERT_EMAIL: 'ops@example.com' }, () => new Promise(() => undefined));
    expect(service.notify({ title: 'slow' })).toBeUndefined();
  });
});
