import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { MailModule } from './mail/mail.module.js';
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
    DatabaseModule,
    MailModule,
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
    // Next phase — modules exist but expose no endpoints yet.
    OrdersModule,
    EscrowModule,
    ChatModule,
    AiStudioModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
