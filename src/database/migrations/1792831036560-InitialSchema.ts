import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1792831036560 implements MigrationInterface {
    name = 'InitialSchema1792831036560'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Primary keys default to uuid_generate_v4(), which lives in this extension.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('customer', 'tailor', 'merchant', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "fullName" character varying, "phone" character varying, "role" "public"."users_role_enum" NOT NULL DEFAULT 'customer', "status" character varying NOT NULL DEFAULT 'active', "emailVerified" boolean NOT NULL DEFAULT false, "passwordHash" character varying, "refreshTokenHash" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."tailor_profiles_kycstatus_enum" AS ENUM('draft', 'pending', 'under_review', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "tailor_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid, "displayName" character varying, "atelierName" character varying, "city" character varying, "craft" character varying, "bio" text, "yearsExperience" integer, "specialtyTags" jsonb NOT NULL DEFAULT '[]', "startingPrice" integer, "portraitUrl" character varying, "coverImageUrl" character varying, "portfolioUrls" jsonb NOT NULL DEFAULT '[]', "rating" numeric(2,1), "reviewCount" integer NOT NULL DEFAULT '0', "legalName" character varying, "workshopAddress" text, "idType" character varying, "idDocumentUrl" character varying, "workshopPhotoUrl" character varying, "guildChapter" character varying, "guildMembershipId" character varying, "bankName" character varying, "accountNumber" character varying, "accountName" character varying, "kycStatus" "public"."tailor_profiles_kycstatus_enum" NOT NULL DEFAULT 'draft', "reviewNote" text, "submittedAt" TIMESTAMP WITH TIME ZONE, "reviewedAt" TIMESTAMP WITH TIME ZONE, "isSample" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9ed489b3ba09bdc620d1ca9831d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b0c2b372254e7add9838780172" ON "tailor_profiles" ("userId") WHERE "userId" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "styles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "category" character varying NOT NULL, "imageUrl" character varying NOT NULL, "startingPrice" integer, "sortOrder" integer NOT NULL DEFAULT '0', "isPublished" boolean NOT NULL DEFAULT true, "isSample" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1f22d2e5045f508c5fce0eb6e86" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."merchant_profiles_sourcingtype_enum" AS ENUM('direct_mill', 'importer')`);
        await queryRunner.query(`CREATE TYPE "public"."merchant_profiles_verificationstatus_enum" AS ENUM('draft', 'pending', 'under_review', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "merchant_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid, "businessName" character varying, "city" character varying, "marketHub" character varying, "sourcingType" "public"."merchant_profiles_sourcingtype_enum", "specialtyFabrics" jsonb NOT NULL DEFAULT '[]', "cacNumber" character varying, "cacCertificateUrl" character varying, "warehousePhotoUrl" character varying, "qualityDeclarationAccepted" boolean NOT NULL DEFAULT false, "bankName" character varying, "accountNumber" character varying, "accountName" character varying, "verificationStatus" "public"."merchant_profiles_verificationstatus_enum" NOT NULL DEFAULT 'draft', "reviewNote" text, "submittedAt" TIMESTAMP WITH TIME ZONE, "reviewedAt" TIMESTAMP WITH TIME ZONE, "isSample" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ee17ef073cf4fe64ffb6292f88e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b57fa1ac5a6a6f7baba2f77df1" ON "merchant_profiles" ("userId") WHERE "userId" IS NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."saved_items_itemtype_enum" AS ENUM('tailor', 'fabric')`);
        await queryRunner.query(`CREATE TABLE "saved_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "itemType" "public"."saved_items_itemtype_enum" NOT NULL, "itemId" uuid NOT NULL, "quantity" integer, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9ffb5147369d77d12744b6eb214" UNIQUE ("userId", "itemType", "itemId"), CONSTRAINT "PK_178c333cea0ad47a6c7a3321349" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."customer_fit_profiles_unit_enum" AS ENUM('in', 'cm')`);
        await queryRunner.query(`CREATE TABLE "customer_fit_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "chest" numeric(5,1), "shoulderWidth" numeric(5,1), "sleeveLength" numeric(5,1), "kaftanLength" numeric(5,1), "waist" numeric(5,1), "neck" numeric(5,1), "drapeSilhouette" character varying NOT NULL DEFAULT 'slim_modern', "unit" "public"."customer_fit_profiles_unit_enum" NOT NULL DEFAULT 'in', "frontPhotoUrl" character varying, "sidePhotoUrl" character varying, "deliveryAddress" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_653fafba29f7f4192c0faf5d76b" UNIQUE ("userId"), CONSTRAINT "PK_bea5b45c042d9ae08656e023047" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."fabrics_unit_enum" AS ENUM('yard', 'bundle')`);
        await queryRunner.query(`CREATE TABLE "fabrics" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "merchantId" uuid NOT NULL, "name" character varying NOT NULL, "category" character varying NOT NULL, "origin" character varying, "description" text, "tags" jsonb NOT NULL DEFAULT '[]', "price" integer NOT NULL, "unit" "public"."fabrics_unit_enum" NOT NULL DEFAULT 'yard', "stock" integer, "imageUrl" character varying NOT NULL, "isPublished" boolean NOT NULL DEFAULT true, "isSample" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_154ff1486274ec43fcea1e04a66" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4b07e56dfebf38876c2a8d08e4" ON "fabrics" ("isPublished", "category") `);
        await queryRunner.query(`CREATE TYPE "public"."otps_purpose_enum" AS ENUM('signup', 'password_reset')`);
        await queryRunner.query(`CREATE TABLE "otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "codeHash" character varying NOT NULL, "purpose" "public"."otps_purpose_enum" NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed" boolean NOT NULL DEFAULT false, "attempts" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_91fef5ed60605b854a2115d2410" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_47150805ba8d7e2bfef734e6d0" ON "otps" ("email", "purpose", "consumed") `);
        await queryRunner.query(`ALTER TABLE "fabrics" ADD CONSTRAINT "FK_48b029fef42a7792f0345c5da09" FOREIGN KEY ("merchantId") REFERENCES "merchant_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fabrics" DROP CONSTRAINT "FK_48b029fef42a7792f0345c5da09"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47150805ba8d7e2bfef734e6d0"`);
        await queryRunner.query(`DROP TABLE "otps"`);
        await queryRunner.query(`DROP TYPE "public"."otps_purpose_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4b07e56dfebf38876c2a8d08e4"`);
        await queryRunner.query(`DROP TABLE "fabrics"`);
        await queryRunner.query(`DROP TYPE "public"."fabrics_unit_enum"`);
        await queryRunner.query(`DROP TABLE "customer_fit_profiles"`);
        await queryRunner.query(`DROP TYPE "public"."customer_fit_profiles_unit_enum"`);
        await queryRunner.query(`DROP TABLE "saved_items"`);
        await queryRunner.query(`DROP TYPE "public"."saved_items_itemtype_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b57fa1ac5a6a6f7baba2f77df1"`);
        await queryRunner.query(`DROP TABLE "merchant_profiles"`);
        await queryRunner.query(`DROP TYPE "public"."merchant_profiles_verificationstatus_enum"`);
        await queryRunner.query(`DROP TYPE "public"."merchant_profiles_sourcingtype_enum"`);
        await queryRunner.query(`DROP TABLE "styles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b0c2b372254e7add9838780172"`);
        await queryRunner.query(`DROP TABLE "tailor_profiles"`);
        await queryRunner.query(`DROP TYPE "public"."tailor_profiles_kycstatus_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
