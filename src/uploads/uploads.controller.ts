import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { CloudinaryService } from './cloudinary.service.js';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

/** What each upload is for decides where it is stored and which file types are accepted. */
const PURPOSES: Record<string, string[]> = {
  'tailor-kyc': DOCUMENT_TYPES,
  'tailor-portfolio': IMAGE_TYPES,
  'merchant-verification': DOCUMENT_TYPES,
  'fit-photo': IMAGE_TYPES,
  fabric: IMAGE_TYPES,
};

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('purpose') purpose = '',
  ) {
    const allowed = PURPOSES[purpose];
    if (!allowed) {
      throw new BadRequestException(`Unknown upload purpose. Use one of: ${Object.keys(PURPOSES).join(', ')}.`);
    }
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
