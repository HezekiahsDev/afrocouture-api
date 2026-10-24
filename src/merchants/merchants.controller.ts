import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { MerchantsService } from './merchants.service.js';
import { SaveMerchantProfileDto } from './dto/submit-merchant-verification.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

@Controller('merchants/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MERCHANT)
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get('profile')
  getMine(@CurrentUser() user: User) {
    return this.merchantsService.getMine(user);
  }

  @Put('profile')
  saveMine(@CurrentUser() user: User, @Body() dto: SaveMerchantProfileDto) {
    return this.merchantsService.saveMine(user, dto);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submitMine(@CurrentUser() user: User) {
    return this.merchantsService.submitMine(user);
  }
}
