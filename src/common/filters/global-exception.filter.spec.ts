import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';

function host(path = '/orders/0f8fad5b-d9cb-469f-a165-70867728950e') {
  const res = { headersSent: false, status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = { method: 'GET', path, requestId: 'rid-12345678' };
  return {
    res,
    host: {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any,
  };
}

describe('GlobalExceptionFilter', () => {
  const alerts = { notify: vi.fn() };
  const filter = new GlobalExceptionFilter(alerts as any);
  beforeEach(() => alerts.notify.mockClear());

  it('alerts on an unexpected error, grouping ids in the route, and returns the request id', () => {
    const { host: h, res } = host();
    filter.catch(new TypeError('cannot read x of undefined'), h);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, requestId: 'rid-12345678' }));
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '500 on GET /orders/:id', signature: 'http:GET /orders/:id:TypeError:cannot read x of undefined' }),
    );
  });

  it('does not alert on deliberate 4xx or 503 responses', () => {
    const a = host();
    filter.catch(new BadRequestException('nope'), a.host);
    const b = host();
    filter.catch(new ServiceUnavailableException("AI Studio isn't available right now."), b.host);
    expect(b.res.status).toHaveBeenCalledWith(503);
    expect(alerts.notify).not.toHaveBeenCalled();
  });
});
