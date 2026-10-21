import "reflect-metadata";
import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate } from "class-validator";

import {
  ChatMessageAlertedPayload,
  MESSAGE_PREVIEW_MAX_LENGTH,
} from "./chat-message-alerted.event";
import { ActorSnapshot, EXCHANGE_NAME, RoutingKeys } from "./event-envelope";
import {
  NotificationCreatedPayload,
  NotificationSeenPayload,
} from "./notification.events";
import { SessionRevokedEvent } from "./session-revoked.event";
import {
  CommentLikedPayload,
  EXCERPT_MAX_LENGTH,
  PostCommentedPayload,
  PostLikedPayload,
  UserFollowedPayload,
} from "./social.events";
import { UserCreatedEvent } from "./user-created.event";

const UUID = "3f2b8c1e-6d4a-4b7e-9a1c-2d5e8f0a1b3c";
const UUID2 = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const actor = {
  userId: UUID,
  username: "anna",
  displayName: "Anna",
  avatarUrl: null,
};

const props = async <T extends object>(
  cls: ClassConstructor<T>,
  plain: Record<string, unknown>,
) =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property).sort();

describe("event-envelope", () => {
  it("exposes the exchange and routing keys", () => {
    expect(EXCHANGE_NAME).toBe("innogram.events");
    expect(RoutingKeys.POST_LIKED).toBe("social.post.liked");
    expect(Object.values(RoutingKeys)).toHaveLength(7);
  });

  it("ActorSnapshot validates a full snapshot", async () => {
    expect(await props(ActorSnapshot, actor)).toEqual([]);
    expect(
      await props(ActorSnapshot, { ...actor, avatarUrl: "http://x/a.png" }),
    ).toEqual([]);
  });

  it("ActorSnapshot rejects bad id and over-long names", async () => {
    expect(
      await props(ActorSnapshot, {
        ...actor,
        userId: "x",
        username: "u".repeat(101),
        displayName: "d".repeat(101),
      }),
    ).toEqual(["displayName", "userId", "username"]);
  });
});

describe("social payloads", () => {
  const cases = [
    ["PostCommentedPayload", PostCommentedPayload, ["postId", "commentId"]],
    ["PostLikedPayload", PostLikedPayload, ["postId"]],
    ["CommentLikedPayload", CommentLikedPayload, ["postId", "commentId"]],
  ] as const;

  it.each(cases)("%s accepts a valid payload", async (_n, cls, ids) => {
    const plain: Record<string, unknown> = {
      actor,
      recipientId: UUID2,
      excerpt: "nice",
    };
    ids.forEach((id) => (plain[id] = UUID));
    expect(await props(cls, plain)).toEqual([]);
  });

  it.each(cases)(
    "%s rejects bad ids, long excerpt and bad nested actor",
    async (_n, cls, ids) => {
      const plain: Record<string, unknown> = {
        actor: { ...actor, userId: "nope" },
        recipientId: "x",
        excerpt: "e".repeat(EXCERPT_MAX_LENGTH + 1),
      };
      ids.forEach((id) => (plain[id] = "bad"));
      expect(await props(cls, plain)).toEqual(
        ["actor", "excerpt", "recipientId", ...ids].sort(),
      );
    },
  );

  it("UserFollowedPayload validates actor and recipient", async () => {
    expect(
      await props(UserFollowedPayload, { actor, recipientId: UUID2 }),
    ).toEqual([]);
    expect(
      await props(UserFollowedPayload, { actor, recipientId: "x" }),
    ).toEqual(["recipientId"]);
  });
});

describe("ChatMessageAlertedPayload", () => {
  const valid = {
    actor,
    recipientId: UUID,
    chatId: UUID2,
    messageId: UUID,
    chatTitle: null,
    preview: "hello",
  };

  it("accepts a valid payload with and without a title", async () => {
    expect(await props(ChatMessageAlertedPayload, valid)).toEqual([]);
    expect(
      await props(ChatMessageAlertedPayload, { ...valid, chatTitle: "Team" }),
    ).toEqual([]);
  });

  it("rejects bad ids and an over-long preview", async () => {
    expect(
      await props(ChatMessageAlertedPayload, {
        ...valid,
        chatId: "x",
        messageId: "y",
        recipientId: "z",
        preview: "p".repeat(MESSAGE_PREVIEW_MAX_LENGTH + 1),
      }),
    ).toEqual(["chatId", "messageId", "preview", "recipientId"]);
  });

  it("rejects a non-string title", async () => {
    expect(
      await props(ChatMessageAlertedPayload, { ...valid, chatTitle: 5 }),
    ).toEqual(["chatTitle"]);
  });
});

describe("notification payloads", () => {
  it("NotificationCreatedPayload validates", async () => {
    const valid = {
      recipientId: UUID,
      notification: { id: "n" },
      unseenCount: 3,
    };
    expect(await props(NotificationCreatedPayload, valid)).toEqual([]);
    expect(
      await props(NotificationCreatedPayload, {
        recipientId: "x",
        notification: "str",
        unseenCount: -1,
      }),
    ).toEqual(["notification", "recipientId", "unseenCount"]);
    expect(
      await props(NotificationCreatedPayload, { ...valid, unseenCount: 1.5 }),
    ).toEqual(["unseenCount"]);
  });

  it("NotificationSeenPayload only allows unseenCount 0", async () => {
    expect(
      await props(NotificationSeenPayload, { userId: UUID, unseenCount: 0 }),
    ).toEqual([]);
    expect(
      await props(NotificationSeenPayload, { userId: "x", unseenCount: 2 }),
    ).toEqual(["unseenCount", "userId"]);
  });
});

describe("SessionRevokedEvent", () => {
  it("defaults sid and jti to null", () => {
    const e = new SessionRevokedEvent(
      UUID,
      undefined,
      undefined,
      "2026-01-01T00:00:00Z",
    );
    expect(e).toMatchObject({ userId: UUID, sid: null, jti: null });
  });

  it("validates a constructed event", async () => {
    expect(
      await validate(
        new SessionRevokedEvent(UUID, "sid", "jti", "2026-01-01T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("rejects a bad userId and timestamp, and an empty (plain-JSON) instance", async () => {
    expect(
      (
        await validate(new SessionRevokedEvent("x", null, null, "yesterday"))
      ).map((e) => e.property),
    ).toEqual(["userId", "revokedAt"]);
    expect(await props(SessionRevokedEvent, {})).toEqual([
      "revokedAt",
      "userId",
    ]);
  });
});

describe("UserCreatedEvent", () => {
  const valid = {
    authUserId: UUID,
    email: "a@b.com",
    handle: "anna",
    timestamp: "2026-01-01T00:00:00.000Z",
  };

  it("hydrates the timestamp into a Date from plain JSON", async () => {
    const e = plainToInstance(UserCreatedEvent, valid);
    expect(e.timestamp).toBeInstanceOf(Date);
    expect(await validate(e)).toEqual([]);
  });

  it("accepts the constructor form", async () => {
    expect(
      await validate(new UserCreatedEvent(UUID, "a@b.com", "anna", new Date())),
    ).toEqual([]);
  });

  it("rejects bad fields", async () => {
    expect(
      await props(UserCreatedEvent, {
        authUserId: "x",
        email: "y",
        handle: "ab",
        timestamp: "not-a-date",
      }),
    ).toEqual(["authUserId", "email", "handle", "timestamp"]);
    expect(
      await props(UserCreatedEvent, { ...valid, handle: "h".repeat(31) }),
    ).toEqual(["handle"]);
  });
});
