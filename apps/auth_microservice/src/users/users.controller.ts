import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from '@repo/shared';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Users') // Groups these endpoints in the Swagger UI
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Register a new user identity' })
  @ApiResponse({ status: 201, description: 'User successfully created.' })
  @ApiResponse({ status: 409, description: 'Email is already registered.' })
  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    // The @Body() decorator combined with CreateUserDto automatically validates the email and password length!
    const user = await this.usersService.createUser(createUserDto);

    // Never return the password hash to the client
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  @ApiOperation({ summary: 'Fetch a user by ID' })
  @Get(':id')
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) return null;

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
