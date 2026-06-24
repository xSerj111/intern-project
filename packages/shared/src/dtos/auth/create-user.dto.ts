import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
export class CreateUserDto {
  @ApiProperty({
    example: 'john.doe@innogram.com'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({
    example: 'Strong@P4ssw0rd!',
    description: 'The unique email address of the user'
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    example: '@johndoe',
    description: 'The public display handle of the user',
    minLength: 3,
    maxLength: 30,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  handle!: string; // e.g. @john_doe
}