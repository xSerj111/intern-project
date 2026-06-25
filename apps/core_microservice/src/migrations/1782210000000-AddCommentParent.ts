import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentParent1782210000000 implements MigrationInterface {
  name = 'AddCommentParent1782210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The Comment entity declares a self-referencing `parentId` (nested comments)
    // that the initial schema never created. Add the column + self FK.
    await queryRunner.query(`ALTER TABLE "comments" ADD "parentId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_parentId" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_comments_parentId"`,
    );
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "parentId"`);
  }
}
