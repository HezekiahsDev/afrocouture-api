import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository, type FindOptionsWhere } from 'typeorm';
import { AiDesign } from './entities/ai-design.entity.js';
import { GenerateDesignDto, ListDesignsQuery, UpdateDesignDto } from './dto/ai-studio.dto.js';
import { ImagenClient } from './imagen.client.js';
import { buildImagenPrompt } from './prompt.js';
import { CloudinaryService } from '../uploads/cloudinary.service.js';
import { User } from '../users/entities/user.entity.js';

export interface Quota {
  used: number;
  limit: number;
  /** Start of the next UTC day, when the count resets. */
  resetsAt: string;
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class AiStudioService {
  private readonly logger = new Logger(AiStudioService.name);
  private readonly dailyLimit: number;

  constructor(
    @InjectRepository(AiDesign) private readonly designs: Repository<AiDesign>,
    private readonly imagen: ImagenClient,
    private readonly cloudinary: CloudinaryService,
    config: ConfigService,
  ) {
    this.dailyLimit = Number(config.get<string | number>('AI_DAILY_LIMIT', 20)) || 20;
  }

  /** Successful generations today count towards the limit; failed ones don't. */
  async quota(user: User): Promise<Quota> {
    const dayStart = startOfUtcDay();
    const used = await this.designs.count({ where: { userId: user.id, createdAt: MoreThanOrEqual(dayStart) } });
    return {
      used,
      limit: this.dailyLimit,
      resetsAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async generate(user: User, dto: GenerateDesignDto): Promise<AiDesign> {
    if (!this.imagen.isConfigured || !this.cloudinary.isConfigured) {
      throw new ServiceUnavailableException("AI Studio isn't available right now.");
    }

    const quota = await this.quota(user);
    if (quota.used >= quota.limit) {
      throw new HttpException(
        {
          message: `You've used all ${quota.limit} designs for today. You can generate more after midnight (UTC).`,
          code: 'AI_DAILY_LIMIT',
          resetsAt: quota.resetsAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const aspectRatio = dto.aspectRatio ?? '3:4';
    const images = await this.imagen.generate(buildImagenPrompt(dto), dto.count ?? 4, aspectRatio);

    const uploads = await Promise.all(
      images.map((image) => this.cloudinary.uploadBuffer(image.bytes, `ai-designs/${user.id}`)),
    );

    return this.designs.save(
      this.designs.create({
        userId: user.id,
        prompt: dto.prompt.trim(),
        options: {
          garmentType: dto.garmentType?.trim() || undefined,
          occasion: dto.occasion?.trim() || undefined,
          fabric: dto.fabric?.trim() || undefined,
          colour: dto.colour?.trim() || undefined,
        },
        imageUrls: uploads.map((u) => u.url),
        selectedIndex: 0,
        model: this.imagen.modelName,
        aspectRatio,
      }),
    );
  }

  list(user: User, query: ListDesignsQuery): Promise<AiDesign[]> {
    const where: FindOptionsWhere<AiDesign> = { userId: user.id };
    if (query.saved) where.saved = query.saved === 'true';
    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) where.createdAt = LessThan(before);
    }
    return this.designs.find({ where, order: { createdAt: 'DESC' }, take: query.limit ?? 20 });
  }

  async get(user: User, id: string): Promise<AiDesign> {
    const design = await this.designs.findOne({ where: { id, userId: user.id } });
    if (!design) throw new NotFoundException('Design not found.');
    return design;
  }

  async update(user: User, id: string, dto: UpdateDesignDto): Promise<AiDesign> {
    const design = await this.get(user, id);
    if (dto.saved !== undefined) design.saved = dto.saved;
    if (dto.selectedIndex !== undefined) {
      if (dto.selectedIndex >= design.imageUrls.length) {
        throw new NotFoundException('That variation does not exist.');
      }
      design.selectedIndex = dto.selectedIndex;
    }
    return this.designs.save(design);
  }

  async remove(user: User, id: string): Promise<void> {
    const design = await this.get(user, id);
    await this.designs.remove(design);
  }
}
