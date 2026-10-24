import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TailorsModule } from '../tailors/tailors.module.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { EscrowModule } from '../escrow/escrow.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { User } from '../users/entities/user.entity.js';
import { Fabric } from '../fabrics/entities/fabric.entity.js';
import { AdminAuditLog } from './audit/admin-audit-log.entity.js';
import { AuditService } from './audit/audit.service.js';
import { AdminController } from './admin.controller.js';
import { AdminOverviewService } from './admin-overview.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminFabricsService } from './admin-fabrics.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminAuditLog, User, Fabric]),
    TailorsModule,
    MerchantsModule,
    OrdersModule,
    EscrowModule,
    ChatModule,
  ],
  controllers: [AdminController],
  providers: [AuditService, AdminOverviewService, AdminUsersService, AdminFabricsService],
})
export class AdminModule {}
