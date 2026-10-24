import { MigrationInterface, QueryRunner } from "typeorm";

export class OrdersPaymentsChatAi1792837224643 implements MigrationInterface {
    name = 'OrdersPaymentsChatAi1792837224643'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('requested', 'quoted', 'declined', 'cancelled', 'paid', 'in_progress', 'delivered', 'completed', 'disputed', 'refunded')`);
        await queryRunner.query(`CREATE TYPE "public"."orders_milestone_enum" AS ENUM('placed', 'cutting', 'fitting', 'delivery')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying NOT NULL, "customerId" uuid NOT NULL, "tailorId" uuid NOT NULL, "tailorUserId" uuid NOT NULL, "status" "public"."orders_status_enum" NOT NULL DEFAULT 'requested', "milestone" "public"."orders_milestone_enum" NOT NULL DEFAULT 'placed', "garmentType" character varying NOT NULL, "brief" text NOT NULL, "styleId" uuid, "aiDesignId" uuid, "referenceImageUrls" jsonb NOT NULL DEFAULT '[]', "fitSnapshot" jsonb NOT NULL, "deliveryAddress" jsonb NOT NULL, "desiredDate" date, "workmanshipPrice" integer, "deliveryFee" integer, "estimatedDeliveryDate" date, "quoteNote" text, "quotedAt" TIMESTAMP WITH TIME ZONE, "declineReason" text, "fabricTotal" integer NOT NULL DEFAULT '0', "platformFee" integer NOT NULL DEFAULT '0', "totalAmount" integer NOT NULL DEFAULT '0', "paystackReference" character varying, "paidAt" TIMESTAMP WITH TIME ZONE, "deliveredAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "disputeReason" text, "disputedAt" TIMESTAMP WITH TIME ZONE, "resolutionNote" text, "rating" integer, "review" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_14ea6251b9edf64025257e7475" ON "orders" ("reference") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_14c547a012204ffe1f1e1de928" ON "orders" ("paystackReference") WHERE "paystackReference" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_cf7170c53fe34a444348fe3d97" ON "orders" ("tailorUserId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_8311c4d0fbd4353ed30b9cd69d" ON "orders" ("customerId", "createdAt") `);
        await queryRunner.query(`CREATE TYPE "public"."order_items_fulfilment_enum" AS ENUM('pending', 'shipped', 'received')`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "fabricId" uuid NOT NULL, "merchantId" uuid NOT NULL, "fabricName" character varying NOT NULL, "imageUrl" character varying NOT NULL, "unit" character varying NOT NULL, "quantity" integer NOT NULL, "unitPrice" integer NOT NULL, "lineTotal" integer NOT NULL, "fulfilment" "public"."order_items_fulfilment_enum" NOT NULL DEFAULT 'pending', "shippingNote" text, "shippedAt" TIMESTAMP WITH TIME ZONE, "receivedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fa7b22b33ff1b46d9c5573b24c" ON "order_items" ("merchantId") `);
        await queryRunner.query(`CREATE TABLE "order_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "type" character varying NOT NULL, "label" character varying NOT NULL, "actorUserId" uuid, "data" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cc1b82b0fcf1be577d9d7ecbf8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_307480e6e5448fcce63c68d1a6" ON "order_events" ("orderId", "createdAt") `);
        await queryRunner.query(`CREATE TYPE "public"."escrow_transactions_type_enum" AS ENUM('hold', 'release_tailor', 'release_merchant', 'refund')`);
        await queryRunner.query(`CREATE TYPE "public"."escrow_transactions_status_enum" AS ENUM('pending', 'success', 'failed', 'reversed')`);
        await queryRunner.query(`CREATE TABLE "escrow_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "type" "public"."escrow_transactions_type_enum" NOT NULL, "status" "public"."escrow_transactions_status_enum" NOT NULL DEFAULT 'pending', "amount" integer NOT NULL, "partyType" character varying NOT NULL, "partyId" uuid NOT NULL, "reference" character varying NOT NULL, "providerCode" character varying, "failureReason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_529d3ac2fa1b343b7beb59bd945" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d8ac563d36a1d84993e2d381c5" ON "escrow_transactions" ("reference") `);
        await queryRunner.query(`CREATE INDEX "IDX_369df14a5041be362c19c13c04" ON "escrow_transactions" ("status", "type") `);
        await queryRunner.query(`CREATE INDEX "IDX_aa97c14e95954a89051baa0fad" ON "escrow_transactions" ("orderId") `);
        await queryRunner.query(`CREATE TYPE "public"."chat_messages_type_enum" AS ENUM('text', 'image', 'system')`);
        await queryRunner.query(`CREATE TABLE "chat_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "senderId" uuid, "type" "public"."chat_messages_type_enum" NOT NULL DEFAULT 'text', "content" text NOT NULL, "attachmentUrl" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c13440c7163e7d349fee5ff8a5" ON "chat_messages" ("orderId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "ai_designs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "prompt" text NOT NULL, "options" jsonb NOT NULL DEFAULT '{}', "imageUrls" jsonb NOT NULL DEFAULT '[]', "selectedIndex" integer NOT NULL DEFAULT '0', "model" character varying NOT NULL, "aspectRatio" character varying NOT NULL DEFAULT '3:4', "saved" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cbbca7a63772ff81988791e3ca1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e338474495badcb4d021a717c1" ON "ai_designs" ("userId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "bankCode" character varying`);
        await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "paystackRecipientCode" character varying`);
        await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "bankCode" character varying`);
        await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "paystackRecipientCode" character varying`);
        await queryRunner.query(`ALTER TABLE "fabrics" ADD "priceTiers" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d"`);
        await queryRunner.query(`ALTER TABLE "fabrics" DROP COLUMN "priceTiers"`);
        await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "paystackRecipientCode"`);
        await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "bankCode"`);
        await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "paystackRecipientCode"`);
        await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "bankCode"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e338474495badcb4d021a717c1"`);
        await queryRunner.query(`DROP TABLE "ai_designs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c13440c7163e7d349fee5ff8a5"`);
        await queryRunner.query(`DROP TABLE "chat_messages"`);
        await queryRunner.query(`DROP TYPE "public"."chat_messages_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aa97c14e95954a89051baa0fad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_369df14a5041be362c19c13c04"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d8ac563d36a1d84993e2d381c5"`);
        await queryRunner.query(`DROP TABLE "escrow_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."escrow_transactions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."escrow_transactions_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_307480e6e5448fcce63c68d1a6"`);
        await queryRunner.query(`DROP TABLE "order_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fa7b22b33ff1b46d9c5573b24c"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TYPE "public"."order_items_fulfilment_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8311c4d0fbd4353ed30b9cd69d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cf7170c53fe34a444348fe3d97"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14c547a012204ffe1f1e1de928"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14ea6251b9edf64025257e7475"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."orders_milestone_enum"`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
    }

}
