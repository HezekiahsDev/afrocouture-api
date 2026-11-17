import { MigrationInterface, QueryRunner } from 'typeorm';
import { CITY_TO_STATE } from '../../orders/fabric-delivery-fee.js';

export class FabricDeliveryState1795100000000 implements MigrationInterface {
  name = 'FabricDeliveryState1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchant_profiles" ADD "state" character varying(60)`);
    await queryRunner.query(`ALTER TABLE "tailor_profiles" ADD "state" character varying(60)`);

    // Existing profiles only stored a city. Best-effort backfill lets delivery pricing work
    // before they update KYC; the same city fallback also stays in the pricing helper.
    await this.backfill(queryRunner, 'merchant_profiles');
    await this.backfill(queryRunner, 'tailor_profiles');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tailor_profiles" DROP COLUMN "state"`);
    await queryRunner.query(`ALTER TABLE "merchant_profiles" DROP COLUMN "state"`);
  }

  private async backfill(queryRunner: QueryRunner, table: 'merchant_profiles' | 'tailor_profiles') {
    for (const [city, state] of Object.entries(CITY_TO_STATE)) {
      await queryRunner.query(
        `UPDATE "${table}" SET "state" = $1 WHERE "state" IS NULL AND LOWER(TRIM("city")) = $2`,
        [state, city],
      );
    }
  }
}
