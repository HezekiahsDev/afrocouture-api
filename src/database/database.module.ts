import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './data-source-options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        // Entities are registered per feature module via forFeature().
        entities: [],
        autoLoadEntities: true,
        // Migrations are run by the CLI (pnpm migration:run), never by the app — and leaving
        // them out lets the in-process e2e tests boot without importing .ts migrations.
        migrations: [],
        migrationsRun: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
