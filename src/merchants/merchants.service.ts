import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantProfile } from './entities/merchant-profile.entity.js';
import { SaveMerchantProfileDto } from './dto/submit-merchant-verification.dto.js';
import { KycStatus } from '../types/index.js';
import { User } from '../users/entities/user.entity.js';
import { MailService } from '../mail/mail.service.js';
import { ReviewDecisionDto } from '../common/dto/review.dto.js';
import { sendReviewOutcome } from '../common/review-mail.js';
import { definedOnly } from '../common/defined-only.js';

/** Fields a verified merchant may keep editing without going back through review. */
const LIVE_EDITABLE: (keyof SaveMerchantProfileDto)[] = ['marketHub', 'specialtyFabrics'];

const REQUIRED_FOR_SUBMIT: [keyof MerchantProfile, string][] = [
  ['businessName', 'your registered business name'],
  ['city', 'your city'],
  ['marketHub', 'your market or warehouse location'],
  ['sourcingType', 'how you source fabric'],
  ['cacNumber', 'your CAC number'],
  ['cacCertificateUrl', 'your CAC certificate'],
  ['bankName', 'your payout bank'],
  ['accountNumber', 'your account number'],
  ['accountName', 'the account name'],
];

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(MerchantProfile)
    private readonly merchantRepository: Repository<MerchantProfile>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mail: MailService,
  ) {}

  async getMine(user: User): Promise<MerchantProfile | null> {
    return this.merchantRepository.findOne({ where: { userId: user.id } });
  }

  async getApprovedMine(user: User): Promise<MerchantProfile> {
    const profile = await this.getMine(user);
    if (profile?.verificationStatus !== KycStatus.APPROVED) {
      throw new ConflictException('Your merchant account must be verified before you can list fabrics.');
    }
    return profile;
  }

  async saveMine(user: User, dto: SaveMerchantProfileDto): Promise<MerchantProfile> {
    let profile = await this.getMine(user);
    if (!profile) profile = this.merchantRepository.create({ userId: user.id });

    if (profile.verificationStatus === KycStatus.PENDING || profile.verificationStatus === KycStatus.UNDER_REVIEW) {
      throw new ConflictException('Your verification is under review. You can edit it once the review is complete.');
    }

    const sent = definedOnly(dto);
    const editable: Partial<SaveMerchantProfileDto> =
      profile.verificationStatus === KycStatus.APPROVED
        ? Object.fromEntries(
            Object.entries(sent).filter(([key]) => LIVE_EDITABLE.includes(key as keyof SaveMerchantProfileDto)),
          )
        : sent;

    Object.assign(profile, editable);
    if (editable.cacNumber) profile.cacNumber = editable.cacNumber.toUpperCase().replace(' ', '-');
    if (profile.verificationStatus === KycStatus.REJECTED) profile.verificationStatus = KycStatus.DRAFT;
    return this.merchantRepository.save(profile);
  }

  async submitMine(user: User): Promise<MerchantProfile> {
    const profile = await this.getMine(user);
    if (!profile) throw new BadRequestException('Save your details before submitting them.');
    if (profile.verificationStatus === KycStatus.APPROVED || profile.verificationStatus === KycStatus.PENDING) {
      return profile;
    }

    const missing = REQUIRED_FOR_SUBMIT.filter(([key]) => {
      const value = profile[key];
      return value === null || value === undefined || value === '';
    }).map(([, label]) => label);
    if (!profile.qualityDeclarationAccepted) missing.push('the quality declaration');
    if (missing.length) {
      throw new BadRequestException({ message: `Add ${missing.join(', ')} before submitting.`, missing });
    }

    profile.verificationStatus = KycStatus.PENDING;
    profile.submittedAt = new Date();
    profile.reviewNote = null;
    return this.merchantRepository.save(profile);
  }

  async listForReview(status: KycStatus): Promise<MerchantProfile[]> {
    return this.merchantRepository.find({
      where: { verificationStatus: status, isSample: false },
      order: { submittedAt: 'ASC' },
    });
  }

  async review(id: string, dto: ReviewDecisionDto): Promise<MerchantProfile> {
    const profile = await this.merchantRepository.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Merchant profile not found.');
    if (
      profile.verificationStatus !== KycStatus.PENDING &&
      profile.verificationStatus !== KycStatus.UNDER_REVIEW
    ) {
      throw new ConflictException(`This merchant is ${profile.verificationStatus}, not awaiting review.`);
    }

    const approved = dto.decision === 'approve';
    profile.verificationStatus = approved ? KycStatus.APPROVED : KycStatus.REJECTED;
    profile.reviewNote = dto.note?.trim() || null;
    profile.reviewedAt = new Date();
    const saved = await this.merchantRepository.save(profile);

    const owner = profile.userId ? await this.userRepository.findOne({ where: { id: profile.userId } }) : null;
    if (owner) await sendReviewOutcome(this.mail, owner.email, 'merchant', approved, profile.reviewNote);
    return saved;
  }
}
