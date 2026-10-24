import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import {
  EmailDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { RateLimit } from '../common/rate-limit/rate-limit.js';

const MIN = 60;
const HOUR = 60 * MIN;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @RateLimit({ name: 'register', limit: 5, windowSec: HOUR, by: ['ip'] })
  async register(@Body() dto: RegisterDto) {
    const { email } = await this.authService.register(dto);
    return { email, message: 'We sent a 6-digit code to your email.' };
  }

  @Post('verify-email')
  @RateLimit({ name: 'verify-email', limit: 10, windowSec: 15 * MIN, by: ['email'] })
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @RateLimit({ name: 'resend-verification', limit: 5, windowSec: HOUR, by: ['email'] })
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: EmailDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'If that account is awaiting verification, a new code is on its way.' };
  }

  @Post('login')
  @RateLimit(
    { name: 'login', limit: 10, windowSec: 15 * MIN, by: ['ip', 'email'] },
    { name: 'login-ip', limit: 30, windowSec: 15 * MIN, by: ['ip'] },
  )
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: User) {
    await this.authService.logout(user.id);
  }

  @Post('forgot-password')
  @RateLimit({ name: 'forgot-password', limit: 5, windowSec: HOUR, by: ['email'] })
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: EmailDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists for that email, a reset code is on its way.' };
  }

  @Post('reset-password')
  @RateLimit({ name: 'reset-password', limit: 10, windowSec: 15 * MIN, by: ['email'] })
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password updated. Sign in with your new password.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User) {
    return user;
  }
}
