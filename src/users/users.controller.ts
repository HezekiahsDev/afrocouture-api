import { Controller, Body, Patch } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { SetRoleDto, UpdateProfileDto } from './dto/set-role.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from './entities/user.entity.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../types/index.js';

@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch()
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Patch('role')
  @Roles(UserRole.CUSTOMER, UserRole.TAILOR, UserRole.MERCHANT)
  setRole(@CurrentUser() user: User, @Body() dto: SetRoleDto) {
    return this.usersService.setRole(user, dto.role);
  }
}
