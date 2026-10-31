import { MigrationInterface, QueryRunner } from "typeorm";

export class Surveys1793445586198 implements MigrationInterface {
    name = 'Surveys1793445586198'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "survey_responses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "surveyId" character varying(40) NOT NULL, "role" character varying(20) NOT NULL, "answers" jsonb NOT NULL DEFAULT '{}', "completedAt" TIMESTAMP WITH TIME ZONE, "promptDismissedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e6bcea9a5a739d418de0f968db8" UNIQUE ("userId", "surveyId"), CONSTRAINT "PK_349995c51959d139d8e485a58ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_460a182f9a84a6f7be2f5a2d8e" ON "survey_responses" ("surveyId", "completedAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_460a182f9a84a6f7be2f5a2d8e"`);
        await queryRunner.query(`DROP TABLE "survey_responses"`);
    }

}
