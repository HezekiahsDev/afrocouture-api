import { MigrationInterface, QueryRunner } from 'typeorm';

/** USDC on Stellar via stellar-payment-service: escrow provider columns, payout method, webhook receipts. */

export class StellarPayments1795850683527 implements MigrationInterface {
  name = 'StellarPayments1795850683527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "stellar_webhook_receipts" ("id" uuid NOT NULL, "type" character varying(32) NOT NULL, "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f565c46a8d6edcbd5f39a841ea5" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "payoutMethod" character varying(10) NOT NULL DEFAULT 'bank'`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "stellarAddress" character varying(56)`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "stellarMemo" character varying(28)`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "payoutMethod" character varying(10) NOT NULL DEFAULT 'bank'`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "stellarAddress" character varying(56)`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "stellarMemo" character varying(28)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "provider" character varying(16) NOT NULL DEFAULT 'paystack'`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "assetAmount" numeric(20,7)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "fxRate" numeric(20,7)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "txHash" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "destination" character varying(69)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "destinationMemo" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "holdReference" character varying`);
    await queryRunner.query(`CREATE INDEX "IDX_b5c00e19c5abafba608b3e442f" ON "escrow_transactions" ("txHash") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_b5c00e19c5abafba608b3e442f"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "holdReference"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "destinationMemo"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "destination"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "txHash"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "fxRate"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "assetAmount"`);
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "provider"`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "stellarMemo"`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "stellarAddress"`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "payoutMethod"`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "stellarMemo"`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "stellarAddress"`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "payoutMethod"`);
    await queryRunner.query(`DROP TABLE "stellar_webhook_receipts"`);
  }
}
