import { Module } from '@nestjs/common';
import { FunctionalRolesController } from './functional-roles.controller.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController, FunctionalRolesController], providers: [UsersService] })
export class UsersModule {}
