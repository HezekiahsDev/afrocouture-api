import {
  BadRequestException,
  ForbiddenException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { CloudinaryService } from './cloudinary.service.js';
import { RateLimit } from '../common/rate-limit/rate-limit.js';
import { UserRole } from '../types/index.js';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

/**
 * What each upload is for decides where it is stored, which file types are accepted and
 * which roles may upload it (chat also covers a customer's reference images on a request).
 */
const PURPOSES: Record<string, { types: string[]; roles: UserRole[] }> = {
  'tailor-kyc': { types: DOCUMENT_TYPES, roles: [UserRole.TAILOR] },
  'tailor-portfolio': { types: IMAGE_TYPES, roles: [UserRole.TAILOR] },
  'merchant-verification': { types: DOCUMENT_TYPES, roles: [UserRole.MERCHANT] },
  'fit-photo': { types: IMAGE_TYPES, roles: [UserRole.CUSTOMER] },
  fabric: { types: IMAGE_TYPES, roles: [UserRole.MERCHANT] },
  chat: { types: IMAGE_TYPES, roles: [UserRole.CUSTOMER, UserRole.TAILOR] },
};

@Controller('uploads')
export class UploadsController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post()
  @RateLimit({ name: 'uploads', limit: 60, windowSec: 60 * 60, by: ['user'] })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('purpose') purpose = '',
  ) {
    const rule = PURPOSES[purpose];
    if (!rule) {
      throw new BadRequestException(`Unknown upload purpose. Use one of: ${Object.keys(PURPOSES).join(', ')}.`);
    }
    if (!rule.roles.includes(user.role)) {
      throw new ForbiddenException("Your account can't upload files for this.");
    }
    const allowed = rule.types;
    if (!file) {
      throw new BadRequestException('Attach a file in the "file" field.');
    }
    if (!allowed.includes(file.mimetype)) {
      const kinds = allowed.includes('application/pdf') ? 'JPG, PNG, WebP or PDF' : 'JPG, PNG or WebP';
      throw new BadRequestException(`Unsupported file type. Upload a ${kinds} file.`);
    }

    const asset = await this.cloudinary.upload(file, `${purpose}/${user.id}`);
    return { ...asset, originalName: file.originalname };
  }
}
