import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';
import type { ListNotificationsQuery, MarkReadDto } from './dto/notification.dto.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  orderId?: string | null;
}

/** In-process event the chat gateway relays to the person's open tabs. */
export const NOTIFICATION_CREATED = 'notification.created';
export interface NotificationCreatedEvent {
  notification: Notification;
  unreadCount: number;
}

/** Read notifications older than this are deleted by the daily clean-up. */
const RETENTION_DAYS = 90;
const MAX_BODY = 280;

const trimBody = (body?: string | null) => {
  const text = body?.trim();
  if (!text) return null;
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly events: EventEmitter2,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const timer = setInterval(() => {
      this.prune().catch((err: unknown) => this.logger.error('Notification clean-up failed', err as Error));
    }, 24 * 60 * 60 * 1000);
    timer.unref?.();
    this.scheduler.addInterval('notifications-prune', timer);
  }

  /**
   * Adds a notification for one person. Best effort: a failure is logged, never thrown,
   * so it can't undo the action that triggered it.
   */
  async notify(userId: string | null | undefined, input: NotificationInput): Promise<void> {
    if (!userId) return;
    try {
      const saved = await this.notifications.save(
        this.notifications.create({
          userId,
          type: input.type,
          title: input.title.trim().slice(0, 200),
          body: trimBody(input.body),
          link: input.link ?? null,
          orderId: input.orderId ?? null,
        }),
      );
      await this.announce(saved);
    } catch (err) {
      this.logger.error(`Could not save "${input.type}" notification for ${userId}`, err as Error);
    }
  }

  /** Notifies every active admin (new submissions, disputes). */
  async notifyAdmins(input: NotificationInput): Promise<void> {
    try {
      const admins = await this.users.find({ where: { role: UserRole.ADMIN, status: 'active' }, select: { id: true } });
      if (!admins.length) return;
      // One insert for everyone, then push to each admin's open tabs.
      const saved = await this.notifications.save(
        admins.map((admin) =>
          this.notifications.create({
            userId: admin.id,
            type: input.type,
            title: input.title.trim().slice(0, 200),
            body: trimBody(input.body),
            link: input.link ?? null,
            orderId: input.orderId ?? null,
          }),
        ),
      );
      await Promise.all(saved.map((n) => this.announce(n)));
    } catch (err) {
      this.logger.error(`Could not notify admins of "${input.type}"`, err as Error);
    }
  }

  /**
   * A new chat message. While the recipient still has an unread chat notification for this
   * order, that one is updated and moved to the top instead of adding another.
   */
  async notifyChat(userId: string, orderId: string, input: Omit<NotificationInput, 'type' | 'orderId'>): Promise<void> {
    try {
      const existing = await this.notifications.findOne({
        where: { userId, orderId, type: 'chat', readAt: IsNull() },
      });
      if (!existing) return this.notify(userId, { ...input, type: 'chat', orderId });
      existing.title = input.title.trim().slice(0, 200);
      existing.body = trimBody(input.body);
      existing.createdAt = new Date();
      await this.announce(await this.notifications.save(existing));
    } catch (err) {
      this.logger.error(`Could not save chat notification for ${userId}`, err as Error);
    }
  }

  async list(userId: string, query: ListNotificationsQuery) {
    const limit = query.limit ?? 20;
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit + 1);
    if (query.before) qb.andWhere('n.createdAt < :before', { before: new Date(query.before) });
    if (query.unread) qb.andWhere('n.readAt IS NULL');
    const rows = await qb.getMany();
    return {
      items: rows.slice(0, limit),
      hasMore: rows.length > limit,
      unreadCount: await this.unreadCount(userId),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, dto: MarkReadDto): Promise<{ unreadCount: number }> {
    const where = dto.all
      ? { userId, readAt: IsNull() }
      : dto.orderId
        ? { userId, orderId: dto.orderId, readAt: IsNull() }
        : dto.ids?.length
          ? { userId, id: In(dto.ids), readAt: IsNull() }
          : null;
    if (where) await this.notifications.update(where, { readAt: new Date() });
    return { unreadCount: await this.unreadCount(userId) };
  }

  /** Deletes read notifications older than RETENTION_DAYS. */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.notifications.delete({ readAt: Not(IsNull()), createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }

  private async announce(notification: Notification) {
    const unreadCount = await this.unreadCount(notification.userId);
    this.events.emit(NOTIFICATION_CREATED, { notification, unreadCount } satisfies NotificationCreatedEvent);
  }
}
