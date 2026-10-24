import { ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PaystackError, PaystackService } from './paystack.service.js';

const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as any;

describe('PaystackService', () => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'AC-ABC123-1' } }));
  const sign = (secret: string) => createHmac('sha512', secret).update(body).digest('hex');

  afterEach(() => vi.unstubAllGlobals());

  it('accepts a webhook signed with our secret key', () => {
    const paystack = new PaystackService(config({ PAYSTACK_SECRET_KEY: 'sk_test_x' }));
    expect(paystack.verifySignature(body, sign('sk_test_x'))).toBe(true);
  });

  it('rejects wrong, missing or tampered signatures', () => {
    const paystack = new PaystackService(config({ PAYSTACK_SECRET_KEY: 'sk_test_x' }));
    expect(paystack.verifySignature(body, sign('sk_test_other'))).toBe(false);
    expect(paystack.verifySignature(body, undefined)).toBe(false);
    expect(paystack.verifySignature(undefined, sign('sk_test_x'))).toBe(false);
    expect(paystack.verifySignature(Buffer.from(body.toString().replace('ABC', 'XYZ')), sign('sk_test_x'))).toBe(false);
  });

  it('rejects every signature when no key is configured', () => {
    const paystack = new PaystackService(config({}));
    expect(paystack.isConfigured).toBe(false);
    expect(paystack.verifySignature(body, sign(''))).toBe(false);
  });

  it('refuses calls with a 503 when not configured', async () => {
    const paystack = new PaystackService(config({}));
    await expect(paystack.verify('AC-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends kobo amounts with the bearer key and surfaces Paystack errors', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: false, message: 'Invalid amount' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const paystack = new PaystackService(config({ PAYSTACK_SECRET_KEY: 'sk_test_x', PAYSTACK_BASE_URL: 'https://paystack.test/' }));
    await expect(
      paystack.initialize({ email: 'a@b.co', amountKobo: 10_890_000, reference: 'AC-1-1', callbackUrl: 'https://x/cb', metadata: { orderId: 'o' } }),
    ).rejects.toBeInstanceOf(PaystackError);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://paystack.test/transaction/initialize');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x');
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 10_890_000, currency: 'NGN', reference: 'AC-1-1' });
  });

  it('caches the bank list and drops inactive banks', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: true,
          data: [
            { name: 'Zenith Bank', code: '057', active: true },
            { name: 'Access Bank', code: '044', active: true },
            { name: 'Closed Bank', code: '000', active: false },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const paystack = new PaystackService(config({ PAYSTACK_SECRET_KEY: 'sk_test_x' }));
    expect(await paystack.listBanks()).toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'Zenith Bank', code: '057' },
    ]);
    await paystack.listBanks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
