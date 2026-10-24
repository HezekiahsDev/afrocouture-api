import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options.js';

// The TypeORM CLI runs outside Nest, so load .env the same way ConfigModule would.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default new DataSource(buildDataSourceOptions());
