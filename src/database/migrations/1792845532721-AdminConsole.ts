import { MigrationInterface, QueryRunner } from "typeorm";

export class AdminConsole1792845532721 implements MigrationInterface {
    name = 'AdminConsole1792845532721'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "admin_audit_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminId" uuid NOT NULL, "action" character varying NOT NULL, "targetType" character varying NOT NULL, "targetId" character varying NOT NULL, "summary" character varying NOT NULL, "details" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9425be48a9c753f5753017c61b2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d2cee1642ac9f8e5da8fa43804" ON "admin_audit_log" ("targetType", "targetId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2e9f4e816754a83f16d2cff589" ON "admin_audit_log" ("createdAt") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "suspendedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "suspensionReason" text`);
        await queryRunner.query(`ALTER TABLE "fabrics" ADD "moderatedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "fabrics" ADD "unpublishedReason" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fabrics" DROP COLUMN "unpublishedReason"`);
        await queryRunner.query(`ALTER TABLE "fabrics" DROP COLUMN "moderatedAt"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "suspensionReason"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "suspendedAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2e9f4e816754a83f16d2cff589"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d2cee1642ac9f8e5da8fa43804"`);
        await queryRunner.query(`DROP TABLE "admin_audit_log"`);
    }

}
