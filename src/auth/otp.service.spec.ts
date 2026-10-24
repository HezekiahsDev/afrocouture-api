import { BadRequestException, HttpException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { OtpService } from './otp.service.js';
import { Otp, OtpPurpose } from './entities/otp.entity.js';

/** Minimal in-memory stand-in for the parts of Repository<Otp> the service uses. */
function fakeRepo() {
  const rows: Otp[] = [];
  return {
    rows,
    findOne: vi.fn(async ({ where, order }: any) => {
      const matches = rows.filter(
        (r) =>
          r.email === where.email &&
          r.purpose === where.purpose &&
          (where.consumed === undefined || r.consumed === where.consumed) &&
          (where.createdAt === undefined || r.createdAt > where.createdAt.value),
      );
      if (order?.createdAt === 'DESC') matches.sort((a, b) => +b.createdAt - +a.createdAt);
      return matches[0] ?? null;
    }),
    update: vi.fn(async (criteria: any, patch: Partial<Otp>) => {
      for (const r of rows) {
        const hit =
          typeof criteria === 'string'
            ? r.id === criteria
            : r.email === criteria.email && r.purpose === criteria.purpose && r.consumed === criteria.consumed;
        if (hit) Object.assign(r, patch);
      }
    }),
    increment: vi.fn(async ({ id }: { id: string }, _col: string, by: number) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.attempts += by;
    }),
    create: vi.fn((data: Partial<Otp>) => ({ consumed: false, attempts: 0, ...data }) as Otp),
    save: vi.fn(async (row: Otp) => {
      row.id ??= `otp-${rows.length + 1}`;
      row.createdAt ??= new Date();
      rows.push(row);
      return row;
    }),
  };
}

describe('OtpService', () => {
  let repo: ReturnType<typeof fakeRepo>;
  let mail: { sendMail: ReturnType<typeof vi.fn> };
  let service: OtpService;

  const sentCode = () => (mail.sendMail.mock.calls.at(-1)![0].text as string).match(/(\d{6})/)![1];

  beforeEach(() => {
    repo = fakeRepo();
    mail = { sendMail: vi.fn(async () => ({ messageId: 'test' })) };
    service = new OtpService(repo as any, mail as any);
  });

  it('emails a 6-digit code and stores only its hash', async () => {
    await service.generateAndSend('Person@Example.com ', OtpPurpose.SIGNUP);
    const code = sentCode();
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'person@example.com' }));
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].codeHash).not.toContain(code);
    expect(await bcrypt.compare(code, repo.rows[0].codeHash)).toBe(true);
  });

  it('throttles a second request within a minute', async () => {
    await service.generateAndSend('a@example.com', OtpPurpose.SIGNUP);
    await expect(service.generateAndSend('a@example.com', OtpPurpose.SIGNUP)).rejects.toBeInstanceOf(HttpException);
  });

  it('accepts the right code once', async () => {
    await service.generateAndSend('a@example.com', OtpPurpose.SIGNUP);
    const code = sentCode();
    await expect(service.verify('a@example.com', code, OtpPurpose.SIGNUP)).resolves.toBeUndefined();
    await expect(service.verify('a@example.com', code, OtpPurpose.SIGNUP)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not accept a code issued for another purpose', async () => {
    await service.generateAndSend('a@example.com', OtpPurpose.PASSWORD_RESET);
    await expect(service.verify('a@example.com', sentCode(), OtpPurpose.SIGNUP)).rejects.toThrow(/No verification code/);
  });

  it('rejects expired codes', async () => {
    await service.generateAndSend('a@example.com', OtpPurpose.SIGNUP);
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.verify('a@example.com', sentCode(), OtpPurpose.SIGNUP)).rejects.toThrow(/expired/);
  });

  it('locks the code after 5 wrong attempts, even if the right code follows', async () => {
    await service.generateAndSend('a@example.com', OtpPurpose.SIGNUP);
    const code = sentCode();
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) {
      await expect(service.verify('a@example.com', wrong, OtpPurpose.SIGNUP)).rejects.toThrow(/Invalid/);
    }
    await expect(service.verify('a@example.com', code, OtpPurpose.SIGNUP)).rejects.toThrow(/Too many/);
  });
});
