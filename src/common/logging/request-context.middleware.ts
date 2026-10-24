import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept an upstream id (nginx, a client retry) only if it looks like one. */
const VALID_ID = /^[\w.:-]{8,128}$/;

/** The id correlates the access log line, error logs, alerts and the error response. */
type WithRequestId = Request & { requestId?: string };

export function requestIdOf(req: Request): string | undefined {
  return (req as WithRequestId).requestId;
}

/** Paths that are polled by monitors and would only add noise. */
const QUIET_PATHS = ['/health'];

/**
 * Gives every request an id (echoed in X-Request-Id) and logs one line when it finishes:
 * method, path without the query string, status, duration and the signed-in user.
 */
export function requestContext({ json = false, logger = new Logger('HTTP') }: { json?: boolean; logger?: Logger } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    (req as WithRequestId).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const path = (req.originalUrl ?? req.url).split('?')[0];
      if (QUIET_PATHS.includes(path)) return;
      const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      const entry = {
        msg: `${req.method} ${path} ${res.statusCode} ${durationMs}ms`,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs,
        requestId,
        ...(userId ? { userId } : {}),
        ip: req.ip,
      };
      // JSON logs keep the fields; text logs stay on one readable line.
      const line = json ? entry : `${entry.msg} rid=${requestId}${userId ? ` user=${userId}` : ''}`;
      if (res.statusCode >= 500) logger.warn(line);
      else logger.log(line);
    });
    next();
  };
}
