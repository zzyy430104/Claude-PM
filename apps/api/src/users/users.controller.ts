import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { CreateUserDto, UpdateUserDto } from './dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.TENANT_ADMIN, Role.TOP_MANAGEMENT)
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Get('directory')
  directory(@CurrentUser() user: AuthUser) {
    return this.users.directory(user);
  }

  @Get(':id')
  @Roles(Role.TENANT_ADMIN, Role.TOP_MANAGEMENT)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user, id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user, id, dto);
  }
}
