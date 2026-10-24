import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { requestContext, requestIdOf } from './request-context.middleware.js';

function fakeExchange(headers: Record<string, string> = {}, url = '/orders?token=secret') {
  const req = {
    method: 'GET',
    originalUrl: url,
    url,
    ip: '10.0.0.1',
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  });
  return { req, res: res as unknown as Response & { headers: Record<string, string>; emit: EventEmitter['emit'] } };
}

describe('requestContext', () => {
  const logger = { log: vi.fn(), warn: vi.fn() };
  beforeEach(() => {
    logger.log.mockClear();
    logger.warn.mockClear();
  });

  it('generates an id, echoes it and logs the path without the query string', () => {
    const { req, res } = fakeExchange();
    const next = vi.fn();
    requestContext({ json: true, logger: logger as any })(req, res, next);
    expect(next).toHaveBeenCalled();
    const id = requestIdOf(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['X-Request-Id']).toBe(id);

    (req as Request & { user?: { id: string } }).user = { id: 'user-1' };
    res.emit('finish');
    const entry = logger.log.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({ method: 'GET', path: '/orders', status: 200, requestId: id, userId: 'user-1' });
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(typeof entry.durationMs).toBe('number');
  });

  it('keeps a well-formed incoming id and replaces a malformed one', () => {
    const good = fakeExchange({ 'x-request-id': 'nginx-abc12345' });
    requestContext({ logger: logger as any })(good.req, good.res, vi.fn());
    expect(requestIdOf(good.req)).toBe('nginx-abc12345');

    const bad = fakeExchange({ 'x-request-id': 'bad id with spaces <script>' });
    requestContext({ logger: logger as any })(bad.req, bad.res, vi.fn());
    expect(requestIdOf(bad.req)).not.toContain('script');
  });

  it('logs 5xx as a warning, one text line in pretty mode, and skips /health', () => {
    const failing = fakeExchange();
    requestContext({ logger: logger as any })(failing.req, failing.res, vi.fn());
    failing.res.statusCode = 500;
    failing.res.emit('finish');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^GET \/orders 500 [\d.]+ms rid=/));

    const health = fakeExchange({}, '/health');
    requestContext({ logger: logger as any })(health.req, health.res, vi.fn());
    health.res.emit('finish');
    expect(logger.log).not.toHaveBeenCalled();
  });
});
