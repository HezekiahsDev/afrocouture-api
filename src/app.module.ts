import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { AlertsModule } from './common/alerts/alerts.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { MailModule } from './mail/mail.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { TailorsModule } from './tailors/tailors.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { FabricsModule } from './fabrics/fabrics.module.js';
import { StylesModule } from './styles/styles.module.js';
import { SavedItemsModule } from './saved-items/saved-items.module.js';
import { MeasurementsModule } from './measurements/measurements.module.js';
import { AdminModule } from './admin/admin.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { EscrowModule } from './escrow/escrow.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AiStudioModule } from './ai-studio/ai-studio.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    MailModule,
    AlertsModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    TailorsModule,
    MerchantsModule,
    FabricsModule,
    StylesModule,
    SavedItemsModule,
    MeasurementsModule,
    AdminModule,
    PaymentsModule,
    OrdersModule,
    EscrowModule,
    ChatModule,
    AiStudioModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Deny by default: authenticated unless @Public(), then @Roles(...) where set. Order matters.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
