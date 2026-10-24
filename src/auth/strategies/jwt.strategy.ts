import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { JwtPayload } from '../../types/index.js';
import { SUSPENDED_MESSAGE } from '../auth.service.js';

/** Resolves the bearer token to the current user row, so role changes take effect immediately. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request: a suspended or unverified account is refused even
   * with an unexpired token, and the role used by RolesGuard is the one stored now.
   */
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    if (user.status !== 'active') {
      throw new UnauthorizedException({ code: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MESSAGE });
    }
    if (!user.emailVerified) {
      throw new UnauthorizedException({ code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to continue.' });
    }
    return user;
  }
}
