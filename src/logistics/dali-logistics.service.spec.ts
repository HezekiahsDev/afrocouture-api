import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DaliError, DaliLogisticsService } from './dali-logistics.service.js';

const SECRET = 'whsec_test_secret';

function service(env: Record<string, string> = {}) {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new DaliLogisticsService(config);
}

function sign(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('DaliLogisticsService webhook signatures', () => {
  const raw = JSON.stringify({ id: 'evt_1', type: 'delivery.assigned' });

  it('accepts a correctly signed raw body', () => {
    const dali = service({ DALI_LOGISTICS_API_KEY: 'dl_live_x', DALI_LOGISTICS_WEBHOOK_SECRET: SECRET });
    const now = Math.floor(Date.now() / 1000);
    expect(dali.verifyWebhookSignature(Buffer.from(raw), sign(SECRET, now, raw))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const dali = service({ DALI_LOGISTICS_API_KEY: 'dl_live_x', DALI_LOGISTICS_WEBHOOK_SECRET: SECRET });
    const now = Math.floor(Date.now() / 1000);
    const header = sign(SECRET, now, raw);
    expect(dali.verifyWebhookSignature(Buffer.from(raw.replace('assigned', 'delivered')), header)).toBe(false);
  });

  it('rejects stale signatures and missing headers/secrets', () => {
    const dali = service({ DALI_LOGISTICS_API_KEY: 'dl_live_x', DALI_LOGISTICS_WEBHOOK_SECRET: SECRET });
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(dali.verifyWebhookSignature(Buffer.from(raw), sign(SECRET, old, raw))).toBe(false);
    expect(dali.verifyWebhookSignature(Buffer.from(raw), undefined)).toBe(false);
    expect(service({ DALI_LOGISTICS_API_KEY: 'dl_live_x' }).verifyWebhookSignature(Buffer.from(raw), sign(SECRET, old + 301, raw))).toBe(
      false,
    );
  });
});

describe('DaliLogisticsService API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a delivery on the partner path with an idempotency key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'job_1', status: 'pending', fee: 981 } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const dali = service({ DALI_LOGISTICS_API_KEY: 'dl_live_x', DALI_LOGISTICS_BASE_URL: 'https://dali.test/' });

    const delivery = await dali.createDelivery({
      externalReference: 'AC-ABC123',
      pickup: { lat: 11.1, lng: 8.1, address: 'Atelier', contact_name: 'Tunde', contact_phone: '+2348012345678' },
      dropoff: { lat: 11.2, lng: 8.2, address: 'Home', contact_name: 'Amina', contact_phone: '+2348098765432' },
      packageCount: 1,
      idempotencyKey: 'ipile-order-1',
    });

    expect(delivery.id).toBe('job_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dali.test/api/v1/partner/v1/deliveries');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('ipile-order-1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dl_live_x');
  });

  it("surfaces Dali's error code and message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, data: null, code: 'insufficient_balance', message: 'Top up to continue.' }),
          { status: 402 },
        ),
      ),
    );
    const dali = service({ DALI_LOGISTICS_API_KEY: 'dl_live_x' });
    await expect(dali.quote({ lat: 11.1, lng: 8.1 }, { lat: 11.2, lng: 8.2 })).rejects.toMatchObject({
      name: 'DaliError',
      status: 402,
      code: 'insufficient_balance',
      message: 'Top up to continue.',
    });
    await expect(dali.account()).rejects.toBeInstanceOf(DaliError);
  });
});
