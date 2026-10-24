import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  } from '@nestjs/common';
import { FabricsService } from './fabrics.service.js';
import { CreateFabricDto, UpdateFabricDto } from './dto/fabric.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('fabrics')
export class FabricsController {
  constructor(private readonly fabricsService: FabricsService) {}

  @Public()
  @Get()
  list(@Query('category') category?: string, @Query('q') q?: string) {
    return this.fabricsService.listPublic({ category, q });
  }

  @Public()
  @Get('categories')
  categories() {
    return this.fabricsService.listCategories();
  }

  @Get('mine')
  @Roles(UserRole.MERCHANT)
  listMine(@CurrentUser() user: User) {
    return this.fabricsService.listMine(user);
  }

  @Post()
  @Roles(UserRole.MERCHANT)
  create(@CurrentUser() user: User, @Body() dto: CreateFabricDto) {
    return this.fabricsService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.MERCHANT)
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFabricDto) {
    return this.fabricsService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.MERCHANT)
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.fabricsService.remove(user, id);
  }

  @Public()
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fabricsService.getPublic(id);
  }
}
