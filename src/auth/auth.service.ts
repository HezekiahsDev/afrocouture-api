import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { User } from '../users/entities/user.entity.js';
import { OtpService } from './otp.service.js';
import { OtpPurpose } from './entities/otp.entity.js';
import { LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './dto/auth.dto.js';
import { JwtPayload, UserRole } from '../types/index.js';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ email: string }> {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing?.emailVerified) {
      throw new ConflictException('An account with this email already exists. Sign in instead.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = existing ?? this.userRepository.create({ email: dto.email });
    user.fullName = dto.fullName.trim();
    user.role = dto.role ?? user.role ?? UserRole.CUSTOMER;
    user.passwordHash = passwordHash;
    await this.userRepository.save(user);

    await this.otpService.generateAndSend(dto.email, OtpPurpose.SIGNUP);
    return { email: dto.email };
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { email } });
    // Respond the same way whether or not the account exists, to avoid leaking emails.
    if (user && !user.emailVerified) {
      await this.otpService.generateAndSend(email, OtpPurpose.SIGNUP);
    }
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<AuthSession> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('No account found for this email. Sign up first.');
    }
    await this.otpService.verify(dto.email, dto.code, OtpPurpose.SIGNUP);
    user.emailVerified = true;
    await this.userRepository.save(user);
    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    const valid = user?.passwordHash ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !valid) {
      throw new UnauthorizedException('Incorrect email or password.');
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('This account has been suspended. Contact support.');
    }
    if (!user.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email to continue. We can send you a new code.',
      });
    }
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.refreshTokenHash')
      .where('user.id = :id', { id: payload.sub })
      .getOne();

    // A mismatch means the token was already rotated (possible replay) — end the session.
    if (!user || user.refreshTokenHash !== sha256(refreshToken) || user.status !== 'active') {
      if (user) await this.userRepository.update(user.id, { refreshTokenHash: null });
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    return this.issueSession(user);
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, { refreshTokenHash: null });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (user?.emailVerified) {
      await this.otpService.generateAndSend(email, OtpPurpose.PASSWORD_RESET);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset code.');
    }
    await this.otpService.verify(dto.email, dto.code, OtpPurpose.PASSWORD_RESET);
    await this.userRepository.update(user.id, {
      passwordHash: await bcrypt.hash(dto.password, 12),
      // Sign out every other device after a password change.
      refreshTokenHash: null,
    });
  }

  private async issueSession(user: User): Promise<AuthSession> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    // jti makes every refresh token unique, even two issued within the same second.
    const refreshToken = await this.jwtService.signAsync({ ...payload, jti: randomUUID() }, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRATION', '7d') as any,
    });
    await this.userRepository.update(user.id, { refreshTokenHash: sha256(refreshToken) });

    const fresh = await this.userRepository.findOneByOrFail({ id: user.id });
    return { accessToken, refreshToken, user: fresh };
  }
}
