import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../orders/entities/order.entity.js';
import { UserRole } from '../types/index.js';

/** Calendar days for the activity chart are Lagos days, whatever the server's timezone. */
const TZ = 'Africa/Lagos';
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Escrow amount still owed to customers, artisans or merchants (excludes platform fees kept on finished orders). */
const ESCROW_HELD_SQL = `
  SELECT COALESCE(SUM(GREATEST(b.balance - CASE WHEN o.status IN ('completed', 'refunded') THEN o."platformFee" ELSE 0 END, 0)), 0) AS held
  FROM (
    SELECT t."orderId",
      SUM(CASE
        WHEN t.type = 'hold' AND t.status = 'success' THEN t.amount
        WHEN t.type <> 'hold' AND t.status IN ('pending', 'success') THEN -t.amount
        ELSE 0 END) AS balance
    FROM escrow_transactions t
    GROUP BY t."orderId"
  ) b
  JOIN orders o ON o.id = b."orderId"`;

@Injectable()
export class AdminOverviewService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async overview() {
    const [users, orders, last30d, money, escrowHeld, queues, reviews, recentActivity] = await Promise.all([
      this.users(),
      this.db.query(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`) as Promise<{ status: OrderStatus; n: number }[]>,
      this.last30Days(),
      this.db.query(`
        SELECT
          COALESCE(SUM(o."totalAmount") FILTER (WHERE o."paidAt" IS NOT NULL), 0) AS gmv,
          COALESCE(SUM(o."platformFee") FILTER (WHERE o."paidAt" IS NOT NULL AND o.status = 'completed'), 0) AS "platformFees",
          (SELECT COALESCE(SUM(amount), 0) FROM escrow_transactions WHERE type = 'refund' AND status IN ('pending', 'success')) AS refunded,
          (SELECT COUNT(*) FROM escrow_transactions WHERE type <> 'hold' AND status = 'failed') AS "failedCount",
          (SELECT COALESCE(SUM(amount), 0) FROM escrow_transactions WHERE type <> 'hold' AND status = 'failed') AS "failedAmount"
        FROM orders o`) as Promise<Record<string, string>[]>,
      this.db.query(ESCROW_HELD_SQL) as Promise<{ held: string }[]>,
      this.db.query(`
        SELECT
          (SELECT COUNT(*) FROM tailor_profiles WHERE "isSample" = false AND "kycStatus" IN ('pending', 'under_review'))
            + (SELECT COUNT(*) FROM merchant_profiles WHERE "isSample" = false AND "verificationStatus" IN ('pending', 'under_review')) AS "pendingVerifications",
          (SELECT COUNT(*) FROM orders WHERE status = 'disputed') AS "openDisputes",
          (SELECT COUNT(*) FROM orders WHERE "reviewHiddenAt" IS NOT NULL) AS "hiddenReviews"`) as Promise<Record<string, string>[]>,
      this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE "reviewHiddenAt" IS NULL) AS count,
          AVG(rating) FILTER (WHERE "reviewHiddenAt" IS NULL) AS average,
          COUNT(*) FILTER (WHERE "reviewedAt" > now() - interval '7 days') AS last7d
        FROM orders WHERE rating IS NOT NULL`) as Promise<{ count: string; average: string | null; last7d: string }[]>,
      this.db.query(`
        SELECT e.id, e."orderId", o.reference, e.type, e.label, e."createdAt"
        FROM order_events e JOIN orders o ON o.id = e."orderId"
        ORDER BY e."createdAt" DESC LIMIT 15`) as Promise<
        { id: string; orderId: string; reference: string; type: string; label: string; createdAt: Date }[]
      >,
    ]);

    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const row of orders) byStatus[row.status] = row.n;
    const m = money[0];
    const q = queues[0];
    const r = reviews[0];
    const failedPayouts = { count: num(m.failedCount), amount: num(m.failedAmount) };

    return {
      users,
      orders: { total: orders.reduce((sum, row) => sum + row.n, 0), byStatus, last30d },
      money: {
        gmv: num(m.gmv),
        platformFees: num(m.platformFees),
        escrowHeld: num(escrowHeld[0]?.held),
        refunded: num(m.refunded),
        failedPayouts,
      },
      queues: {
        pendingVerifications: num(q.pendingVerifications),
        openDisputes: num(q.openDisputes),
        failedPayouts: failedPayouts.count,
        hiddenReviews: num(q.hiddenReviews),
      },
      reviews: {
        count: num(r.count),
        average: r.average === null ? null : Math.round(Number(r.average) * 10) / 10,
        last7d: num(r.last7d),
      },
      recentActivity,
    };
  }

  private async users() {
    const [row] = (await this.db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE role = 'customer') AS customer,
        COUNT(*) FILTER (WHERE role = 'tailor') AS tailor,
        COUNT(*) FILTER (WHERE role = 'merchant') AS merchant,
        COUNT(*) FILTER (WHERE role = 'admin') AS admin,
        COUNT(*) FILTER (WHERE "createdAt" > now() - interval '7 days') AS "newLast7d",
        COUNT(*) FILTER (WHERE status = 'suspended') AS suspended
      FROM users`)) as Record<string, string>[];
    return {
      total: num(row.total),
      byRole: Object.fromEntries(Object.values(UserRole).map((role) => [role, num(row[role])])) as Record<UserRole, number>,
      newLast7d: num(row.newLast7d),
      suspended: num(row.suspended),
    };
  }

  /** 30 Lagos calendar days ending today: orders created, and naira paid, per day. */
  private async last30Days(): Promise<{ date: string; count: number; gmv: number }[]> {
    const rows = (await this.db.query(
      `
      WITH days AS (
        SELECT generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, interval '1 day')::date AS d
      ),
      created AS (
        SELECT ("createdAt" AT TIME ZONE $1)::date AS d, COUNT(*) AS n
        FROM orders WHERE "createdAt" > now() - interval '31 days' GROUP BY 1
      ),
      paid AS (
        SELECT ("paidAt" AT TIME ZONE $1)::date AS d, SUM("totalAmount") AS gmv
        FROM orders WHERE "paidAt" > now() - interval '31 days' GROUP BY 1
      )
      SELECT to_char(days.d, 'YYYY-MM-DD') AS date, COALESCE(created.n, 0) AS count, COALESCE(paid.gmv, 0) AS gmv
      FROM days
      LEFT JOIN created ON created.d = days.d
      LEFT JOIN paid ON paid.d = days.d
      ORDER BY days.d`,
      [TZ],
    )) as { date: string; count: string; gmv: string }[];
    return rows.map((row) => ({ date: row.date, count: num(row.count), gmv: num(row.gmv) }));
  }
}
