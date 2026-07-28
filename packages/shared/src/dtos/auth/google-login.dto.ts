import { IsNotEmpty, IsString } from "class-validator";

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty({ message: "Google idToken is required" })
  idToken!: string;
}
