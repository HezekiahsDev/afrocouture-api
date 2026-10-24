import { MigrationInterface, QueryRunner } from "typeorm";

export class OnboardingPath1792869037240 implements MigrationInterface {
    name = 'OnboardingPath1792869037240'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "pathChosenAt" TIMESTAMP WITH TIME ZONE`);
        // Everyone who signed up before this step existed already picked a role at sign-up.
        await queryRunner.query(`UPDATE "users" SET "pathChosenAt" = "createdAt"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pathChosenAt"`);
    }

}
