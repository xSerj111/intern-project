import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { PAGE_SIZE_MAX } from "@repo/contracts";

/** Mirrors the contracts `PostStatus` values (shared cannot import contracts). */
export const POST_LIST_STATUSES = ["draft", "published", "archived"] as const;
export type PostListStatus = (typeof POST_LIST_STATUSES)[number];

/** Highest page size accepted by `GET /posts/author/:userId`. */
export const POSTS_BY_AUTHOR_MAX_LIMIT = PAGE_SIZE_MAX;

/** Query of `GET /posts/author/:userId` (matches `IPostsByAuthorQuery`). */
export class PostsByAuthorQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: POSTS_BY_AUTHOR_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTS_BY_AUTHOR_MAX_LIMIT)
  limit: number = 20;

  @ApiPropertyOptional({
    enum: POST_LIST_STATUSES,
    default: "published",
    description:
      "Statuses other than published are only allowed for the author's own posts (403 otherwise)",
  })
  @IsOptional()
  @IsIn(POST_LIST_STATUSES)
  status: PostListStatus = "published";
}
