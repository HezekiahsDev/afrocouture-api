import { MigrationInterface, QueryRunner } from 'typeorm';

/** USDC on Stellar: checkout intents, unmatched deposits, watcher cursor, escrow provider columns, payout method. */
export class StellarPayments1795708931522 implements MigrationInterface {
  name = 'StellarPayments1795708931522';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "stellar_payment_intents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "reference" character varying(28) NOT NULL, "nairaAmount" integer NOT NULL, "usdcAmount" numeric(20,7) NOT NULL, "fxRate" numeric(20,7) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'awaiting', "payerAddress" character varying(56), "refundAddress" character varying(56), "refundMemo" character varying(28), "txHash" character varying(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_104d6dcb85277c3efd2c5fb9b2b" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_423fe08b29a10b28ebf78cac0a" ON "stellar_payment_intents" ("orderId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c8661a274e3f8096a2055dcb11" ON "stellar_payment_intents" ("reference") `);
    await queryRunner.query(`CREATE INDEX "IDX_edd1021a6a490f3031af14f115" ON "stellar_payment_intents" ("status", "expiresAt") `);
    await queryRunner.query(`CREATE TABLE "stellar_unmatched_deposits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "operationId" character varying(40) NOT NULL, "txHash" character varying(64) NOT NULL, "fromAddress" character varying(56) NOT NULL, "amount" numeric(20,7) NOT NULL, "assetCode" character varying(12), "assetIssuer" character varying(56), "memo" character varying(64), "reason" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "orderId" uuid, "refundAddress" character varying(56), "refundMemo" character varying(28), "refundTxHash" character varying(64), "refundSubmittedUntil" TIMESTAMP WITH TIME ZONE, "note" text, "resolvedByUserId" uuid, "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_882d05394925e3292ceece9d437" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_df49c45ed0273c24e5c467a3b0" ON "stellar_unmatched_deposits" ("operationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_108e112c28d488ea39b80dca40" ON "stellar_unmatched_deposits" ("status") `);
    await queryRunner.query(`CREATE TABLE "stellar_cursors" ("key" character varying(40) NOT NULL, "pagingToken" character varying(40) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_84d73c8646ea378ae96900a630a" PRIMARY KEY ("key"))`);
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
    await queryRunner.query(`ALTER TABLE "escrow_transactions" ADD "submittedUntil" TIMESTAMP WITH TIME ZONE`);
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
    await queryRunner.query(`ALTER TABLE "escrow_transactions" DROP COLUMN "submittedUntil"`);
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
    await queryRunner.query(`DROP TABLE "stellar_cursors"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_108e112c28d488ea39b80dca40"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_df49c45ed0273c24e5c467a3b0"`);
    await queryRunner.query(`DROP TABLE "stellar_unmatched_deposits"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_edd1021a6a490f3031af14f115"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c8661a274e3f8096a2055dcb11"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_423fe08b29a10b28ebf78cac0a"`);
    await queryRunner.query(`DROP TABLE "stellar_payment_intents"`);
  }
}
