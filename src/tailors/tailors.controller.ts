import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { TailorsService } from './tailors.service.js';
import { SaveTailorProfileDto } from './dto/submit-tailor-kyc.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('tailors')
export class TailorsController {
  constructor(private readonly tailorsService: TailorsService) {}

  @Public()
  @Get()
  list(@Query('city') city?: string, @Query('q') q?: string) {
    return this.tailorsService.listPublic({ city, q });
  }

  @Get('me/profile')
  @Roles(UserRole.TAILOR)
  getMine(@CurrentUser() user: User) {
    return this.tailorsService.getMine(user);
  }

  @Put('me/profile')
  @Roles(UserRole.TAILOR)
  saveMine(@CurrentUser() user: User, @Body() dto: SaveTailorProfileDto) {
    return this.tailorsService.saveMine(user, dto);
  }

  @Post('me/submit')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  submitMine(@CurrentUser() user: User) {
    return this.tailorsService.submitMine(user);
  }

  @Public()
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tailorsService.getPublic(id);
  }
}
