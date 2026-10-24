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
  UseGuards,
} from '@nestjs/common';
import { AiStudioService } from './ai-studio.service.js';
import { GenerateDesignDto, ListDesignsQuery, UpdateDesignDto } from './dto/ai-studio.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/rate-limit/rate-limit.js';
import { User } from '../users/entities/user.entity.js';

@Controller('ai-studio')
@UseGuards(JwtAuthGuard)
export class AiStudioController {
  constructor(private readonly aiStudio: AiStudioService) {}

  @Post('generate')
  // Burst guard on top of the daily quota (AI_DAILY_LIMIT).
  @RateLimit({ name: 'ai-generate', limit: 10, windowSec: 60, by: ['user'] })
  generate(@CurrentUser() user: User, @Body() dto: GenerateDesignDto) {
    return this.aiStudio.generate(user, dto);
  }

  @Get('quota')
  quota(@CurrentUser() user: User) {
    return this.aiStudio.quota(user);
  }

  @Get('designs')
  list(@CurrentUser() user: User, @Query() query: ListDesignsQuery) {
    return this.aiStudio.list(user, query);
  }

  @Get('designs/:id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.aiStudio.get(user, id);
  }

  @Patch('designs/:id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDesignDto) {
    return this.aiStudio.update(user, id, dto);
  }

  @Delete('designs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.aiStudio.remove(user, id);
  }
}
