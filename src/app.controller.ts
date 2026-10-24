import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

/** Liveness and health checks for uptime monitors. */
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const health = await this.appService.getHealth();
    res.setHeader('Cache-Control', 'no-store');
    if (health.status !== 'ok') res.status(503);
    return health;
  }
}
