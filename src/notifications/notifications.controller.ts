import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { ListNotificationsQuery, MarkReadDto } from './dto/notification.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User) {
    return { unreadCount: await this.notifications.unreadCount(user.id) };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: User, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto);
  }
}
