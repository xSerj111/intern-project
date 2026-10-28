import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-points every foreign key that referenced `user_profiles.id` to instead
 * reference `user_profiles.authUserId`.
 *
 * The application stores the auth user id (the JWT `sub`) in these columns
 * (`posts.authorId`, `comments.authorId`, `chat_participants.userId`,
 * `messages.authorId`, `profile_to_profile_configurations.actorId/targetId`),
 * but the FKs were created against the core-local primary key `id`. That made
 * inserts fail with a foreign-key violation (auth id != profile id) and left
 * the `author`/`user`/`actor`/`target` relations unresolvable.
 *
 * `authUserId` carries a UNIQUE constraint, so it is a valid FK target.
 */
export class RepointProfileReferencesToAuthUserId1786000000000 implements MigrationInterface {
  name = 'RepointProfileReferencesToAuthUserId1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old FKs (referencing user_profiles.id)...
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_4548cc4a409b8651ec75f70e280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" DROP CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP CONSTRAINT "FK_fb6add83b1a7acc94433d385692"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_819e6bb0ee78baf73c398dc707f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_45337f6685d4dce74b707521cf7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_291f7082dd6e481496570358e87"`,
    );

    // ...and re-add them against user_profiles.authUserId.
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_authorId_authUserId" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("authUserId") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD CONSTRAINT "FK_posts_authorId_authUserId" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("authUserId") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD CONSTRAINT "FK_chat_participants_userId_authUserId" FOREIGN KEY ("userId") REFERENCES "user_profiles"("authUserId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_authorId_authUserId" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("authUserId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_profile_configurations_actorId_authUserId" FOREIGN KEY ("actorId") REFERENCES "user_profiles"("authUserId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_profile_configurations_targetId_authUserId" FOREIGN KEY ("targetId") REFERENCES "user_profiles"("authUserId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_profile_configurations_targetId_authUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_profile_configurations_actorId_authUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_authorId_authUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP CONSTRAINT "FK_chat_participants_userId_authUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" DROP CONSTRAINT "FK_posts_authorId_authUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_comments_authorId_authUserId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_291f7082dd6e481496570358e87" FOREIGN KEY ("targetId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_45337f6685d4dce74b707521cf7" FOREIGN KEY ("actorId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_819e6bb0ee78baf73c398dc707f" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD CONSTRAINT "FK_fb6add83b1a7acc94433d385692" FOREIGN KEY ("userId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_4548cc4a409b8651ec75f70e280" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
