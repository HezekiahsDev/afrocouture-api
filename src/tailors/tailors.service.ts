import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { TailorProfile } from './entities/tailor-profile.entity.js';
import { SaveTailorProfileDto } from './dto/submit-tailor-kyc.dto.js';
import { KycStatus } from '../types/index.js';
import { User } from '../users/entities/user.entity.js';
import { MailService } from '../mail/mail.service.js';
import { ReviewDecisionDto } from '../common/dto/review.dto.js';
import { sendReviewOutcome } from '../common/review-mail.js';
import { definedOnly } from '../common/defined-only.js';

/** Fields an approved artisan may keep editing without going back through review. */
const LIVE_EDITABLE: (keyof SaveTailorProfileDto)[] = [
  'craft',
  'bio',
  'specialtyTags',
  'startingPrice',
  'portraitUrl',
  'coverImageUrl',
  'portfolioUrls',
];

/** Fields that must be filled before a profile can be submitted for review. */
const REQUIRED_FOR_SUBMIT: [keyof TailorProfile, string][] = [
  ['displayName', 'your display name'],
  ['atelierName', 'your atelier name'],
  ['city', 'your city'],
  ['craft', 'a one-line description of your craft'],
  ['startingPrice', 'a starting price'],
  ['portraitUrl', 'a portrait photo'],
  ['legalName', 'your legal name'],
  ['workshopAddress', 'your workshop address'],
  ['idType', 'an ID type'],
  ['idDocumentUrl', 'a photo of your ID'],
  ['bankName', 'your payout bank'],
  ['accountNumber', 'your account number'],
  ['accountName', 'the account name'],
];

export type PublicTailor = Pick<
  TailorProfile,
  | 'id'
  | 'displayName'
  | 'atelierName'
  | 'city'
  | 'craft'
  | 'bio'
  | 'yearsExperience'
  | 'specialtyTags'
  | 'startingPrice'
  | 'portraitUrl'
  | 'coverImageUrl'
  | 'portfolioUrls'
  | 'reviewCount'
  | 'isSample'
> & { rating: number | null; verified: boolean };

export function toPublicTailor(p: TailorProfile): PublicTailor {
  return {
    id: p.id,
    displayName: p.displayName,
    atelierName: p.atelierName,
    city: p.city,
    craft: p.craft,
    bio: p.bio,
    yearsExperience: p.yearsExperience,
    specialtyTags: p.specialtyTags,
    startingPrice: p.startingPrice,
    portraitUrl: p.portraitUrl,
    coverImageUrl: p.coverImageUrl,
    portfolioUrls: p.portfolioUrls,
    reviewCount: p.reviewCount,
    rating: p.rating === null ? null : Number(p.rating),
    verified: p.kycStatus === KycStatus.APPROVED && !p.isSample,
    isSample: p.isSample,
  };
}

@Injectable()
export class TailorsService {
  constructor(
    @InjectRepository(TailorProfile)
    private readonly tailorRepository: Repository<TailorProfile>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mail: MailService,
  ) {}

  // ── Public directory ──

  async listPublic(filters: { city?: string; q?: string }): Promise<PublicTailor[]> {
    const qb = this.tailorRepository
      .createQueryBuilder('t')
      .where('t.kycStatus = :approved', { approved: KycStatus.APPROVED })
      .orderBy('t.isSample', 'ASC')
      .addOrderBy('t.rating', 'DESC', 'NULLS LAST')
      .addOrderBy('t.createdAt', 'DESC');

    if (filters.city) {
      qb.andWhere('LOWER(t.city) = LOWER(:city)', { city: filters.city });
    }
    if (filters.q) {
      const like = `%${filters.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('t.displayName ILIKE :like', { like })
            .orWhere('t.atelierName ILIKE :like', { like })
            .orWhere('t.craft ILIKE :like', { like })
            .orWhere('CAST(t.specialtyTags AS text) ILIKE :like', { like }),
        ),
      );
    }
    return (await qb.getMany()).map(toPublicTailor);
  }

  async getPublic(id: string): Promise<PublicTailor> {
    const profile = await this.tailorRepository.findOne({ where: { id, kycStatus: KycStatus.APPROVED } });
    if (!profile) throw new NotFoundException('This artisan could not be found.');
    return toPublicTailor(profile);
  }

  // ── Owner ──

  async getMine(user: User): Promise<TailorProfile | null> {
    return this.tailorRepository.findOne({ where: { userId: user.id } });
  }

  async saveMine(user: User, dto: SaveTailorProfileDto): Promise<TailorProfile> {
    let profile = await this.getMine(user);
    if (!profile) {
      profile = this.tailorRepository.create({ userId: user.id, displayName: user.fullName ?? null });
    }

    if (profile.kycStatus === KycStatus.PENDING || profile.kycStatus === KycStatus.UNDER_REVIEW) {
      throw new ConflictException('Your profile is under review. You can edit it once the review is complete.');
    }

    const sent = definedOnly(dto);
    const editable =
      profile.kycStatus === KycStatus.APPROVED
        ? Object.fromEntries(
            Object.entries(sent).filter(([key]) => LIVE_EDITABLE.includes(key as keyof SaveTailorProfileDto)),
          )
        : sent;

    Object.assign(profile, editable);
    if (profile.kycStatus === KycStatus.REJECTED) profile.kycStatus = KycStatus.DRAFT;
    return this.tailorRepository.save(profile);
  }

  async submitMine(user: User): Promise<TailorProfile> {
    const profile = await this.getMine(user);
    if (!profile) throw new BadRequestException('Save your profile before submitting it.');
    if (profile.kycStatus === KycStatus.APPROVED) return profile;
    if (profile.kycStatus === KycStatus.PENDING) return profile;

    const missing = REQUIRED_FOR_SUBMIT.filter(([key]) => {
      const value = profile[key];
      return value === null || value === undefined || value === '';
    }).map(([, label]) => label);
    if (missing.length) {
      throw new BadRequestException({ message: `Add ${missing.join(', ')} before submitting.`, missing });
    }

    profile.kycStatus = KycStatus.PENDING;
    profile.submittedAt = new Date();
    profile.reviewNote = null;
    return this.tailorRepository.save(profile);
  }

  // ── Admin ──

  async listForReview(status: KycStatus): Promise<TailorProfile[]> {
    return this.tailorRepository.find({ where: { kycStatus: status, isSample: false }, order: { submittedAt: 'ASC' } });
  }

  async review(id: string, dto: ReviewDecisionDto): Promise<TailorProfile> {
    const profile = await this.tailorRepository.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Tailor profile not found.');
    if (profile.kycStatus !== KycStatus.PENDING && profile.kycStatus !== KycStatus.UNDER_REVIEW) {
      throw new ConflictException(`This profile is ${profile.kycStatus}, not awaiting review.`);
    }

    const approved = dto.decision === 'approve';
    profile.kycStatus = approved ? KycStatus.APPROVED : KycStatus.REJECTED;
    profile.reviewNote = dto.note?.trim() || null;
    profile.reviewedAt = new Date();
    const saved = await this.tailorRepository.save(profile);

    const owner = profile.userId ? await this.userRepository.findOne({ where: { id: profile.userId } }) : null;
    if (owner) await sendReviewOutcome(this.mail, owner.email, 'artisan', approved, profile.reviewNote);
    return saved;
  }
}
