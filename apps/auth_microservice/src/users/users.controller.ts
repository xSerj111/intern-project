import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from '@repo/shared';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
   // The @Body() decorator combined with CreateUserDto automatically validates the email and password length!
    const user = await this.usersService.createUser(createUserDto);

    // Never return the password hash to the client
    const { passwordHash, ...safeUser} = user;
    return safeUser;
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) return null;

    const { passwordHash, ...safeUser} = user;
    return safeUser;
  }

 
}
