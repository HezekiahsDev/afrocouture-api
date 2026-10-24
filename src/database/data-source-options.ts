import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

const here = dirname(fileURLToPath(import.meta.url));
// Match only the running file type: dist/ also contains .d.ts files that must not be loaded.
const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

/**
 * Shared by the Nest app and the TypeORM CLI (migrations, seed).
 * Schema changes only ever go through migrations — `synchronize` stays off in
 * every environment so local and server databases cannot drift apart.
 */
export function buildDataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER ?? 'afrocouture',
    password: env.DB_PASSWORD ?? 'afrocouture_dev',
    database: env.DB_NAME ?? 'afrocouture',
    entities: [join(here, '..', '**', `*.entity.${ext}`)],
    migrations: [join(here, 'migrations', `*.${ext}`)],
    synchronize: false,
    logging: env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error'],
  };
}
