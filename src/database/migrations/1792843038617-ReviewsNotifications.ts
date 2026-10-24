import { MigrationInterface, QueryRunner } from "typeorm";

export class ReviewsNotifications1792843038617 implements MigrationInterface {
    name = 'ReviewsNotifications1792843038617'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" character varying NOT NULL, "title" character varying NOT NULL, "body" text, "link" character varying, "orderId" uuid, "readAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_notifications_unread" ON "notifications" ("userId") WHERE "readAt" IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_21e65af2f4f242d4c85a92aff4" ON "notifications" ("userId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "orders" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "reviewReply" text`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "reviewRepliedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "reviewHiddenAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reviewHiddenAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reviewRepliedAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reviewReply"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reviewedAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21e65af2f4f242d4c85a92aff4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_notifications_unread"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
    }

}
