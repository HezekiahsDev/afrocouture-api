import { MigrationInterface, QueryRunner } from 'typeorm';

export class LogisticsDelivery1794200000000 implements MigrationInterface {
  name = 'LogisticsDelivery1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."logistics_deliveries_status_enum" AS ENUM('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled', 'failed', 'disputed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "logistics_deliveries" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"orderId" uuid NOT NULL, ` +
        `"externalReference" character varying NOT NULL, ` +
        `"daliId" character varying, ` +
        `"status" "public"."logistics_deliveries_status_enum" NOT NULL DEFAULT 'pending', ` +
        `"livemode" boolean NOT NULL DEFAULT true, ` +
        `"fee" integer NOT NULL DEFAULT '0', ` +
        `"currency" character varying NOT NULL DEFAULT 'NGN', ` +
        `"distanceM" integer, ` +
        `"deliveryPin" character varying, ` +
        `"runner" jsonb, ` +
        `"pickup" jsonb NOT NULL, ` +
        `"dropoff" jsonb NOT NULL, ` +
        `"packageCount" integer NOT NULL DEFAULT '1', ` +
        `"notes" text, ` +
        `"cancelReason" text, ` +
        `"lastError" text, ` +
        `"assignedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"pickedUpAt" TIMESTAMP WITH TIME ZONE, ` +
        `"deliveredAt" TIMESTAMP WITH TIME ZONE, ` +
        `"completedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"cancelledAt" TIMESTAMP WITH TIME ZONE, ` +
        `"failedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"lastSyncedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_logistics_deliveries" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_logistics_deliveries_external_reference" ON "logistics_deliveries" ("externalReference")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_logistics_deliveries_dali_id" ON "logistics_deliveries" ("daliId") WHERE "daliId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logistics_deliveries_order_created" ON "logistics_deliveries" ("orderId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "logistics_webhook_events" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"eventId" character varying NOT NULL, ` +
        `"type" character varying NOT NULL, ` +
        `"deliveryId" uuid, ` +
        `"jobId" character varying, ` +
        `"livemode" boolean NOT NULL DEFAULT true, ` +
        `"payload" jsonb NOT NULL, ` +
        `"error" text, ` +
        `"processedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_logistics_webhook_events" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_logistics_webhook_events_event_id" ON "logistics_webhook_events" ("eventId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logistics_webhook_events_delivery_created" ON "logistics_webhook_events" ("deliveryId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_logistics_webhook_events_delivery_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logistics_webhook_events_event_id"`);
    await queryRunner.query(`DROP TABLE "logistics_webhook_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logistics_deliveries_order_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logistics_deliveries_dali_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logistics_deliveries_external_reference"`);
    await queryRunner.query(`DROP TABLE "logistics_deliveries"`);
    await queryRunner.query(`DROP TYPE "public"."logistics_deliveries_status_enum"`);
  }
}
