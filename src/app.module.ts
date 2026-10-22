import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { TailorsModule } from './tailors/tailors.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { FabricsModule } from './fabrics/fabrics.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { EscrowModule } from './escrow/escrow.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AiStudioModule } from './ai-studio/ai-studio.module.js';
import { MeasurementsModule } from './measurements/measurements.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    AuthModule,
    UsersModule,
    TailorsModule,
    MerchantsModule,
    FabricsModule,
    OrdersModule,
    EscrowModule,
    ChatModule,
    AiStudioModule,
    MeasurementsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
