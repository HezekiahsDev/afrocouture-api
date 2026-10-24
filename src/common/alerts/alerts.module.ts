import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service.js';

/** Global so any service (escrow, the exception filter, main.ts) can raise an alert. */
@Global()
@Module({
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
