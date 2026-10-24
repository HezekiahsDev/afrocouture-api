import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository, type FindOptionsWhere } from 'typeorm';
import { AdminAuditLog } from './admin-audit-log.entity.js';
import { User } from '../../users/entities/user.entity.js';
import type { ListAuditQuery } from '../dto/admin.dto.js';

export type AuditAction =
  | 'verification.approve'
  | 'verification.reject'
  | 'dispute.resolve'
  | 'payout.retry'
  | 'user.suspend'
  | 'user.reactivate'
  | 'review.hide'
  | 'review.unhide'
  | 'fabric.publish'
  | 'fabric.unpublish';

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId: string;
  summary: string;
  details?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AdminAuditLog) private readonly log: Repository<AdminAuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Records an admin action that already succeeded. Never throws: a logging failure must not undo the action. */
  async record(admin: Pick<User, 'id'>, entry: AuditEntry): Promise<void> {
    try {
      await this.log.save(
        this.log.create({
          adminId: admin.id,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          summary: entry.summary.slice(0, 500),
          details: entry.details ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`Could not record audit entry ${entry.action} ${entry.targetType}:${entry.targetId}`, err as Error);
    }
  }

  async list(query: ListAuditQuery) {
    const limit = query.limit ?? 30;
    const where: FindOptionsWhere<AdminAuditLog> = {};
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.adminId) where.adminId = query.adminId;
    if (query.before) where.createdAt = LessThan(new Date(query.before));
    const rows = await this.log.find({ where, order: { createdAt: 'DESC', id: 'DESC' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    const adminIds = [...new Set(page.map((r) => r.adminId))];
    const admins = adminIds.length
      ? await this.users.find({ where: { id: In(adminIds) }, select: { id: true, fullName: true, email: true } })
      : [];
    return {
      items: page.map(({ adminId, ...row }) => {
        const admin = admins.find((a) => a.id === adminId);
        return { ...row, admin: { id: adminId, fullName: admin?.fullName ?? null, email: admin?.email ?? null } };
      }),
      hasMore: rows.length > limit,
    };
  }
}
