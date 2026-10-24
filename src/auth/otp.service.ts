import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { Otp, OtpPurpose } from './entities/otp.entity.js';
import { MailService } from '../mail/mail.service.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * How long the request waits for SMTP before responding anyway. The code is
 * already stored, so a slow (not failed) send must not hold the HTTP request
 * open until a proxy times out. Mirrors dali-be's OtpService.
 */
const SEND_TIMEOUT_MS = 10_000;

const subjects: Record<OtpPurpose, string> = {
  [OtpPurpose.SIGNUP]: 'Verify your AfroCouture AI account',
  [OtpPurpose.PASSWORD_RESET]: 'Reset your AfroCouture AI password',
};

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(Otp) private readonly otpRepository: Repository<Otp>,
    private readonly mailService: MailService,
  ) {}

  async generateAndSend(email: string, purpose: OtpPurpose): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    const recent = await this.otpRepository.findOne({
      where: {
        email: normalizedEmail,
        purpose,
        createdAt: MoreThan(new Date(Date.now() - RESEND_COOLDOWN_MS)),
      },
    });
    if (recent) {
      throw new HttpException(
        'Please wait a minute before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Cryptographically secure — Math.random() is predictable and unfit for OTPs.
    const code = randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);

    await this.otpRepository.update({ email: normalizedEmail, purpose, consumed: false }, { consumed: true });
    await this.otpRepository.save(
      this.otpRepository.create({
        email: normalizedEmail,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      }),
    );

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:480px">
        <h2 style="color:#00a3ff;margin:0 0 8px">Your verification code</h2>
        <p style="font-size:36px;font-weight:700;letter-spacing:8px;color:#00a3ff;margin:12px 0">${code}</p>
        <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="color:#64748b;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    try {
      await this.sendWithTimeout(normalizedEmail, subjects[purpose], code, html);
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${normalizedEmail}`, err as Error);
      throw new InternalServerErrorException('Failed to send verification email');
    }
  }

  async verify(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const otp = await this.otpRepository.findOne({
      where: { email: normalizedEmail, purpose, consumed: false },
      order: { createdAt: 'DESC' },
    });

    if (!otp) {
      throw new BadRequestException('No verification code found. Please request a new one.');
    }
    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      await this.otpRepository.update(otp.id, { consumed: true });
      throw new BadRequestException('Too many failed attempts. Please request a new code.');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.otpRepository.increment({ id: otp.id }, 'attempts', 1);
      throw new BadRequestException('Invalid verification code.');
    }

    await this.otpRepository.update(otp.id, { consumed: true });
  }

  private async sendWithTimeout(to: string, subject: string, code: string, html: string): Promise<void> {
    const send = this.mailService.sendMail({
      to,
      subject,
      text: `Your AfroCouture AI verification code is: ${code}. It expires in 10 minutes.`,
      html,
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SEND_TIMEOUT_MS);
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([send.then(() => 'sent' as const), timeout]);
      if (outcome === 'timeout') {
        // Keep the send running; log a late failure instead of leaving it unhandled.
        send.catch((err: unknown) => {
          this.logger.error(`Slow OTP email to ${to} failed after the response was sent`, err as Error);
        });
        this.logger.warn(`OTP email to ${to} still pending after ${SEND_TIMEOUT_MS}ms; responding anyway`);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
