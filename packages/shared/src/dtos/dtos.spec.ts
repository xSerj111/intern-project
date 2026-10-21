import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateUserDto } from "./auth/create-user.dto";
import { GoogleLoginDto } from "./auth/google-login.dto";
import { LoginDto } from "./auth/login.dto";
import { CreateCommentDto } from "./core/create-comment.dto";
import {
  POSTS_BY_AUTHOR_MAX_LIMIT,
  PostsByAuthorQueryDto,
} from "./core/posts-by-author-query.dto";
import { UpdateCommentDto } from "./core/update-comment.dto";
import { UpdateProfileDto } from "./core/update-profile.dto";

const UUID = "3f2b8c1e-6d4a-4b7e-9a1c-2d5e8f0a1b3c";

const errorsFor = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) => {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property).sort();
};

describe("auth DTOs", () => {
  it("CreateUserDto accepts a valid email and password", async () => {
    expect(
      await errorsFor(CreateUserDto, {
        email: "a@b.com",
        password: "longenough",
      }),
    ).toEqual([]);
  });

  it("CreateUserDto rejects a bad email and short password", async () => {
    expect(
      await errorsFor(CreateUserDto, { email: "nope", password: "short" }),
    ).toEqual(["email", "password"]);
    expect(
      await errorsFor(CreateUserDto, { email: "a@b.com", password: 12345678 }),
    ).toEqual(["password"]);
  });

  it("LoginDto validates email and password", async () => {
    expect(
      await errorsFor(LoginDto, { email: "a@b.com", password: "longenough" }),
    ).toEqual([]);
    expect(await errorsFor(LoginDto, { email: "x", password: "y" })).toEqual([
      "email",
      "password",
    ]);
  });

  it("GoogleLoginDto requires a non-empty idToken", async () => {
    expect(await errorsFor(GoogleLoginDto, { idToken: "tok" })).toEqual([]);
    expect(await errorsFor(GoogleLoginDto, { idToken: "" })).toEqual([
      "idToken",
    ]);
    expect(await errorsFor(GoogleLoginDto, {})).toEqual(["idToken"]);
  });
});

describe("CreateCommentDto", () => {
  it("accepts a comment with and without a parent", async () => {
    expect(
      await errorsFor(CreateCommentDto, { postId: UUID, content: "hi" }),
    ).toEqual([]);
    expect(
      await errorsFor(CreateCommentDto, {
        postId: UUID,
        content: "hi",
        parentId: UUID,
      }),
    ).toEqual([]);
  });

  it("rejects bad ids, empty and over-long content", async () => {
    expect(
      await errorsFor(CreateCommentDto, {
        postId: "x",
        content: "",
        parentId: "y",
      }),
    ).toEqual(["content", "parentId", "postId"]);
    expect(
      await errorsFor(CreateCommentDto, {
        postId: UUID,
        content: "a".repeat(301),
      }),
    ).toEqual(["content"]);
  });
});

describe("UpdateCommentDto", () => {
  it("content is optional but bounded", async () => {
    expect(await errorsFor(UpdateCommentDto, {})).toEqual([]);
    expect(await errorsFor(UpdateCommentDto, { content: "ok" })).toEqual([]);
    expect(
      await errorsFor(UpdateCommentDto, { content: "a".repeat(301) }),
    ).toEqual(["content"]);
    expect(await errorsFor(UpdateCommentDto, { content: 5 })).toEqual([
      "content",
    ]);
  });
});

describe("PostsByAuthorQueryDto", () => {
  it("applies defaults", async () => {
    const dto = plainToInstance(PostsByAuthorQueryDto, {});
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ page: 1, limit: 20, status: "published" });
  });

  it("coerces numeric query strings", async () => {
    const dto = plainToInstance(PostsByAuthorQueryDto, {
      page: "2",
      limit: "50",
      status: "draft",
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ page: 2, limit: 50, status: "draft" });
  });

  it("rejects out-of-range and unknown values", async () => {
    expect(
      await errorsFor(PostsByAuthorQueryDto, {
        page: "0",
        limit: String(POSTS_BY_AUTHOR_MAX_LIMIT + 1),
        status: "deleted",
      }),
    ).toEqual(["limit", "page", "status"]);
    expect(await errorsFor(PostsByAuthorQueryDto, { page: "1.5" })).toEqual([
      "page",
    ]);
  });
});

describe("UpdateProfileDto", () => {
  it("accepts an empty body and a full body", async () => {
    expect(await errorsFor(UpdateProfileDto, {})).toEqual([]);
    expect(
      await errorsFor(UpdateProfileDto, {
        displayName: "Anna",
        bio: "hello",
        avatarAssetId: UUID,
      }),
    ).toEqual([]);
  });

  it("trims the display name before validating", async () => {
    const dto = plainToInstance(UpdateProfileDto, { displayName: "  Anna  " });
    expect(await validate(dto)).toEqual([]);
    expect(dto.displayName).toBe("Anna");

    expect(await errorsFor(UpdateProfileDto, { displayName: "   " })).toEqual([
      "displayName",
    ]);
  });

  it("leaves a non-string display name for @IsString to reject", async () => {
    expect(await errorsFor(UpdateProfileDto, { displayName: 5 })).toEqual([
      "displayName",
    ]);
  });

  it("bounds display name and bio length", async () => {
    expect(
      await errorsFor(UpdateProfileDto, {
        displayName: "a".repeat(101),
        bio: "b".repeat(161),
      }),
    ).toEqual(["bio", "displayName"]);
  });

  it("allows null to clear bio and avatar, but validates a set avatar id", async () => {
    expect(
      await errorsFor(UpdateProfileDto, { bio: null, avatarAssetId: null }),
    ).toEqual([]);
    expect(
      await errorsFor(UpdateProfileDto, { avatarAssetId: "not-a-uuid" }),
    ).toEqual(["avatarAssetId"]);
  });
});
