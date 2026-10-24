import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AlertsService } from '../alerts/alerts.service.js';
import { requestIdOf } from '../logging/request-context.middleware.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(@Optional() private readonly alerts?: AlertsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      this.logger.error('Unhandled non-HTTP exception', exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = requestIdOf(request);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // 4xx are the caller's problem and already appear in the access log. Deliberate 502/503s
    // (a provider down, a feature switched off) are logged; crashes and 500s raise an alert.
    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      // Route pattern (":id") rather than the concrete path so one bug is one alert.
      const route = `${request.method} ${(request.route as { path?: string } | undefined)?.path ?? request.path.replace(UUID, ':id')}`;
      const unexpected = !(exception instanceof HttpException) || status === HttpStatus.INTERNAL_SERVER_ERROR;
      if (unexpected) {
        this.logger.error(`${status} on ${route} [rid=${requestId ?? '-'}]: ${err.message}`, err.stack);
        this.alerts?.notify({
          title: `${status} on ${route}`,
          details: [`${err.name}: ${err.message}`, `Request id: ${requestId ?? '-'}`, err.stack ?? ''].join('\n'),
          signature: `http:${route}:${err.name}:${err.message}`,
        });
      } else {
        this.logger.warn(`${status} on ${route} [rid=${requestId ?? '-'}]: ${err.message}`);
      }
    }

    if (response.headersSent) return;
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
      error: typeof message === 'object' ? message : { message },
    });
  }
}
