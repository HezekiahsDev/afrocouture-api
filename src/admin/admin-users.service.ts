import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Brackets, DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { MailService } from '../mail/mail.service.js';
import { USER_SUSPENDED } from '../chat/chat.service.js';
import { UserRole } from '../types/index.js';
import type { ListUsersQuery } from './dto/admin.dto.js';

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
  orderCount: number;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly mail: MailService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async list(query: ListUsersQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.db.getRepository(User).createQueryBuilder('u');
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      qb.andWhere(new Brackets((w) => w.where('u.email ILIKE :like', { like }).orWhere('u.fullName ILIKE :like', { like })));
    }
    const total = await qb.getCount();
    const users = await qb
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
    const counts = await this.orderCounts(users.map((u) => u.id));
    return { items: users.map((u) => this.row(u, counts.get(u.id) ?? 0)), total, page, limit };
  }

  async detail(id: string) {
    const user = await this.db
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect(['u.suspendedAt', 'u.suspensionReason'])
      .where('u.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('User not found.');

    const [tailor, merchant, counts, recentOrders] = await Promise.all([
      this.db.getRepository(TailorProfile).findOne({ where: { userId: id } }),
      this.db.getRepository(MerchantProfile).findOne({ where: { userId: id } }),
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE "customerId" = $1) AS "asCustomer",
           COUNT(*) FILTER (WHERE "tailorUserId" = $1) AS "asTailor",
           COALESCE(SUM("totalAmount") FILTER (WHERE "customerId" = $1 AND "paidAt" IS NOT NULL), 0) AS spent
         FROM orders WHERE "customerId" = $1 OR "tailorUserId" = $1`,
        [id],
      ) as Promise<{ asCustomer: string; asTailor: string; spent: string }[]>,
      this.db.getRepository(Order).createQueryBuilder('o')
        .select(['o.id', 'o.reference', 'o.status', 'o.garmentType', 'o.totalAmount', 'o.createdAt', 'o.customerId'])
        .where('o.customerId = :id OR o.tailorUserId = :id', { id })
        .orderBy('o.createdAt', 'DESC')
        .take(10)
        .getMany(),
    ]);
    let earned = 0;
    if (tailor) {
      const [row] = (await this.db.query(
        `SELECT COALESCE(SUM(amount), 0) AS earned FROM escrow_transactions
         WHERE "partyType" = 'tailor' AND "partyId" = $1 AND type = 'release_tailor' AND status IN ('pending', 'success')`,
        [tailor.id],
      )) as { earned: string }[];
      earned = Number(row.earned);
    }
    const c = counts[0];
    const ordersAsCustomer = Number(c?.asCustomer ?? 0);
    const ordersAsTailor = Number(c?.asTailor ?? 0);
    return {
      user: {
        ...this.row(user, ordersAsCustomer + ordersAsTailor),
        updatedAt: user.updatedAt,
        suspendedAt: user.suspendedAt ?? null,
        suspensionReason: user.suspensionReason ?? null,
      },
      tailorProfile: tailor
        ? {
            id: tailor.id,
            displayName: tailor.displayName,
            atelierName: tailor.atelierName,
            city: tailor.city,
            kycStatus: tailor.kycStatus,
            rating: tailor.rating === null ? null : Number(tailor.rating),
            reviewCount: tailor.reviewCount,
          }
        : null,
      merchantProfile: merchant
        ? { id: merchant.id, businessName: merchant.businessName, city: merchant.city, verificationStatus: merchant.verificationStatus }
        : null,
      stats: { ordersAsCustomer, ordersAsTailor, spent: Number(c?.spent ?? 0), earned },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        reference: o.reference,
        status: o.status,
        garmentType: o.garmentType,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        as: o.customerId === id ? ('customer' as const) : ('tailor' as const),
      })),
    };
  }

  /** Blocks sign-in, refresh, every request and live sockets for the account. */
  async suspend(admin: User, id: string, reason: string): Promise<AdminUserRow> {
    const user = await this.target(admin, id, 'suspend');
    if (user.status === 'suspended') throw new ConflictException('This account is already suspended.');
    const note = reason.trim();
    await this.db.getRepository(User).update(id, {
      status: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: note,
      refreshTokenHash: null,
    });
    this.events.emit(USER_SUSPENDED, { userId: id });
    void this.email(user, 'Your AfroCouture account has been suspended', [
      'An AfroCouture administrator has suspended your account, so you can no longer sign in.',
      `Reason: ${note}`,
      `If you think this is a mistake, contact ${this.support()} and we will look into it.`,
    ]);
    return this.reload(id);
  }

  async reactivate(admin: User, id: string): Promise<AdminUserRow> {
    const user = await this.target(admin, id, 'reactivate');
    if (user.status !== 'suspended') throw new ConflictException('Only suspended accounts can be reactivated.');
    await this.db.getRepository(User).update(id, { status: 'active', suspendedAt: null, suspensionReason: null });
    void this.email(user, 'Your AfroCouture account is active again', [
      'An AfroCouture administrator has reactivated your account. You can sign in again.',
      `Questions? Contact ${this.support()}.`,
    ]);
    return this.reload(id);
  }

  private async target(admin: User, id: string, verb: string): Promise<User> {
    const user = await this.db.getRepository(User).findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.id === admin.id) throw new ForbiddenException(`You can't ${verb} your own account.`);
    if (user.role === UserRole.ADMIN) throw new ForbiddenException(`Admin accounts can't be ${verb}d from the dashboard.`);
    return user;
  }

  private async reload(id: string): Promise<AdminUserRow> {
    const user = await this.db.getRepository(User).findOneOrFail({ where: { id } });
    const counts = await this.orderCounts([id]);
    return this.row(user, counts.get(id) ?? 0);
  }

  private async orderCounts(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows = (await this.db.query(
      `SELECT u.id, COUNT(o.id) AS n
       FROM unnest($1::uuid[]) AS u(id)
       LEFT JOIN orders o ON o."customerId" = u.id OR o."tailorUserId" = u.id
       GROUP BY u.id`,
      [ids],
    )) as { id: string; n: string }[];
    for (const r of rows) map.set(r.id, Number(r.n));
    return map;
  }

  private row(u: User, orderCount: number): AdminUserRow {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName ?? null,
      phone: u.phone ?? null,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      orderCount,
    };
  }

  private support(): string {
    return this.config.get<string>('SUPPORT_EMAIL')?.trim() || 'AfroCouture support by replying to this email';
  }

  /** Best effort: the status change stands even if the email can't be sent. */
  private async email(user: User, subject: string, lines: string[]) {
    try {
      await this.mail.sendMail({
        to: user.email,
        subject,
        text: [`Hello ${user.fullName ?? ''}`.trim() + ',', '', ...lines].join('\n'),
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px">
          <p>Hello ${escape(user.fullName ?? '')},</p>${lines.map((l) => `<p>${escape(l)}</p>`).join('')}</div>`,
      });
    } catch (err) {
      this.logger.error(`Could not email ${user.email} about "${subject}"`, err as Error);
    }
  }
}
