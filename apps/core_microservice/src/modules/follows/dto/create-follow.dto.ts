import { ApiProperty } from "@nestjs/swagger";
import { ICreateFollowRequest } from "@repo/contracts";
import { IsUUID } from "class-validator";

export class CreateFollowDto implements ICreateFollowRequest {
  @ApiProperty({ description: 'The ID of the user to follow' })
  @IsUUID()
  followingId!: string;
}