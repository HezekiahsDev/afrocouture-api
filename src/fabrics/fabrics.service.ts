import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Fabric, type PriceTier } from './entities/fabric.entity.js';
import { checkPriceTiers } from './price-tiers.js';
import { CreateFabricDto, UpdateFabricDto } from './dto/fabric.dto.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { User } from '../users/entities/user.entity.js';
import { KycStatus } from '../types/index.js';
import { definedOnly } from '../common/defined-only.js';

export interface PublicFabric {
  id: string;
  name: string;
  category: string;
  origin: string | null;
  description: string | null;
  tags: string[];
  price: number;
  unit: string;
  priceTiers: PriceTier[];
  imageUrl: string;
  isSample: boolean;
  merchant: { id: string; businessName: string | null; city: string | null; verified: boolean };
}

function toPublicFabric(f: Fabric): PublicFabric {
  return {
    id: f.id,
    name: f.name,
    category: f.category,
    origin: f.origin,
    description: f.description,
    tags: f.tags,
    price: f.price,
    unit: f.unit,
    priceTiers: f.priceTiers ?? [],
    imageUrl: f.imageUrl,
    isSample: f.isSample,
    merchant: {
      id: f.merchant.id,
      businessName: f.merchant.businessName,
      city: f.merchant.city,
      verified: f.merchant.verificationStatus === KycStatus.APPROVED && !f.merchant.isSample,
    },
  };
}

@Injectable()
export class FabricsService {
  constructor(
    @InjectRepository(Fabric) private readonly fabricRepository: Repository<Fabric>,
    private readonly merchants: MerchantsService,
  ) {}

  /** Published fabrics from verified merchants only. */
  async listPublic(filters: { category?: string; q?: string }): Promise<PublicFabric[]> {
    const qb = this.fabricRepository
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.merchant', 'm')
      .where('f.isPublished = true')
      .andWhere('m.verificationStatus = :approved', { approved: KycStatus.APPROVED })
      .orderBy('f.isSample', 'ASC')
      .addOrderBy('f.createdAt', 'DESC');

    if (filters.category) {
      qb.andWhere('LOWER(f.category) = LOWER(:category)', { category: filters.category });
    }
    if (filters.q) {
      const like = `%${filters.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('f.name ILIKE :like', { like })
            .orWhere('f.category ILIKE :like', { like })
            .orWhere('CAST(f.tags AS text) ILIKE :like', { like })
            .orWhere('m.businessName ILIKE :like', { like }),
        ),
      );
    }
    return (await qb.getMany()).map(toPublicFabric);
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.fabricRepository
      .createQueryBuilder('f')
      .innerJoin('f.merchant', 'm')
      .select('DISTINCT f.category', 'category')
      .where('f.isPublished = true')
      .andWhere('m.verificationStatus = :approved', { approved: KycStatus.APPROVED })
      .orderBy('category')
      .getRawMany<{ category: string }>();
    return rows.map((r) => r.category);
  }

  async getPublic(id: string): Promise<PublicFabric> {
    const fabric = await this.fabricRepository.findOne({ where: { id, isPublished: true }, relations: { merchant: true } });
    if (!fabric || fabric.merchant.verificationStatus !== KycStatus.APPROVED) {
      throw new NotFoundException('This fabric could not be found.');
    }
    return toPublicFabric(fabric);
  }

  async listMine(user: User): Promise<Fabric[]> {
    const merchant = await this.merchants.getMine(user);
    if (!merchant) return [];
    return this.fabricRepository.find({ where: { merchantId: merchant.id }, order: { createdAt: 'DESC' } });
  }

  async create(user: User, dto: CreateFabricDto): Promise<Fabric> {
    const merchant = await this.merchants.getApprovedMine(user);
    const priceTiers = this.validTiers(dto.priceTiers ?? [], dto.price);
    return this.fabricRepository.save(
      this.fabricRepository.create({ ...definedOnly(dto), priceTiers, merchantId: merchant.id }),
    );
  }

  async update(user: User, id: string, dto: UpdateFabricDto): Promise<Fabric> {
    const fabric = await this.ownedFabric(user, id);
    Object.assign(fabric, definedOnly(dto));
    // Re-check even when only the base price changed: tiers must stay below it.
    fabric.priceTiers = this.validTiers(fabric.priceTiers ?? [], fabric.price);
    return this.fabricRepository.save(fabric);
  }

  async remove(user: User, id: string): Promise<void> {
    const fabric = await this.ownedFabric(user, id);
    await this.fabricRepository.remove(fabric);
  }

  private validTiers(tiers: PriceTier[], basePrice: number): PriceTier[] {
    const result = checkPriceTiers(
      tiers.map((t) => ({ minQuantity: t.minQuantity, price: t.price })),
      basePrice,
    );
    if (!result.ok) throw new BadRequestException(result.message);
    return result.tiers;
  }

  private async ownedFabric(user: User, id: string): Promise<Fabric> {
    const merchant = await this.merchants.getApprovedMine(user);
    const fabric = await this.fabricRepository.findOne({ where: { id } });
    if (!fabric) throw new NotFoundException('Fabric not found.');
    if (fabric.merchantId !== merchant.id) throw new ForbiddenException('You can only edit your own fabrics.');
    return fabric;
  }
}
