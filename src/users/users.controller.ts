import { Controller, Body, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { SetRoleDto, UpdateProfileDto } from './dto/set-role.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from './entities/user.entity.js';

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch()
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Patch('role')
  setRole(@CurrentUser() user: User, @Body() dto: SetRoleDto) {
    return this.usersService.setRole(user, dto.role);
  }
}
