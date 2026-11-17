import { MigrationInterface, QueryRunner } from 'typeorm';

export class TailorContact1795000000000 implements MigrationInterface {
  name = 'TailorContact1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "contactPhone" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "whatsappNumber" character varying(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "whatsappNumber"`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "contactPhone"`);
  }
}