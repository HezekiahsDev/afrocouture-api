import { ConsoleLogger } from '@nestjs/common';

/**
 * JSON lines in production (one object per line, easy to grep or ship to a log service);
 * coloured text in development. LOG_FORMAT=json|pretty overrides the NODE_ENV default.
 */
export function useJsonLogs(env: NodeJS.ProcessEnv = process.env): boolean {
  const format = env.LOG_FORMAT?.toLowerCase();
  return format === 'json' || (format !== 'pretty' && env.NODE_ENV === 'production');
}

export function createAppLogger(json = useJsonLogs()): ConsoleLogger {
  return new ConsoleLogger({ json, colors: !json, timestamp: !json });
}
