import { MigrationInterface, QueryRunner } from 'typeorm';

export class FabricCheckout1794300000000 implements MigrationInterface {
  name = 'FabricCheckout1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."orders_type_enum" AS ENUM('commission', 'fabric')`);
    await queryRunner.query(`CREATE TYPE "public"."orders_fabricdestination_enum" AS ENUM('customer', 'tailor')`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "type" "public"."orders_type_enum" NOT NULL DEFAULT 'commission'`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "fabricDestination" "public"."orders_fabricdestination_enum"`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "tailorId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "tailorUserId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "fitSnapshot" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "deliveryAddress" DROP NOT NULL`);
  }

  /** Fails while fabric orders exist: they hold payment records, so they must be dealt with deliberately. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "deliveryAddress" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "fitSnapshot" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "tailorUserId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "tailorId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "fabricDestination"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "public"."orders_fabricdestination_enum"`);
    await queryRunner.query(`DROP TYPE "public"."orders_type_enum"`);
  }
}
