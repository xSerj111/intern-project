import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
export class CreateUserDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  handle!: string; // e.g. @john_doe
}