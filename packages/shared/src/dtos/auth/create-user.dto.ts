import { IsEmail, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class CreateUserDto {
  @ApiProperty({
    example: "john.doe@innogram.com",
  })
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;

  @ApiProperty({
    example: "Strong@P4ssw0rd!",
    description: "The account password, at least 8 characters",
  })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  password!: string;
}
