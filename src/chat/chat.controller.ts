import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';

@Controller('orders/:id/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.list(orderId, user.id, { before, limit: limit ? Number(limit) : undefined });
  }

  @Post()
  send(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) orderId: string, @Body() dto: SendMessageDto) {
    return this.chat.send(orderId, user.id, dto);
  }
}
