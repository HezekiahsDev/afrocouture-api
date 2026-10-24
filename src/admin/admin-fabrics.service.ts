import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Fabric } from '../fabrics/entities/fabric.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ListAdminFabricsQuery, ModerateFabricDto } from './dto/admin.dto.js';

function toAdminFabric(f: Fabric) {
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
    stock: f.stock,
    imageUrl: f.imageUrl,
    isPublished: f.isPublished,
    isSample: f.isSample,
    moderatedAt: f.moderatedAt,
    unpublishedReason: f.unpublishedReason,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    merchant: { id: f.merchant.id, businessName: f.merchant.businessName, verificationStatus: f.merchant.verificationStatus },
  };
}
export type AdminFabric = ReturnType<typeof toAdminFabric>;

@Injectable()
export class AdminFabricsService {
  constructor(
    @InjectRepository(Fabric) private readonly fabrics: Repository<Fabric>,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListAdminFabricsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.fabrics.createQueryBuilder('f').innerJoinAndSelect('f.merchant', 'm');
    if (query.published !== undefined) qb.andWhere('f.isPublished = :published', { published: query.published });
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w.where('f.name ILIKE :like', { like }).orWhere('f.category ILIKE :like', { like }).orWhere('m.businessName ILIKE :like', { like }),
        ),
      );
    }
    const [rows, total] = await qb
      .orderBy('f.createdAt', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items: rows.map(toAdminFabric), total, page, limit };
  }

  /**
   * Publishes or unpublishes a listing. An admin unpublish locks it (the merchant can't
   * republish) until an admin publishes it again.
   */
  async moderate(id: string, dto: ModerateFabricDto): Promise<{ fabric: AdminFabric; changed: boolean }> {
    const fabric = await this.fabrics.findOne({ where: { id }, relations: { merchant: true } });
    if (!fabric) throw new NotFoundException('Fabric not found.');
    const changed = fabric.isPublished !== dto.isPublished || (!dto.isPublished && !fabric.moderatedAt);
    if (dto.isPublished) {
      fabric.isPublished = true;
      fabric.moderatedAt = null;
      fabric.unpublishedReason = null;
    } else {
      fabric.isPublished = false;
      fabric.moderatedAt = new Date();
      fabric.unpublishedReason = dto.note!.trim();
    }
    const saved = await this.fabrics.save(fabric);
    if (changed) {
      void this.notifications.notify(fabric.merchant.userId, {
        type: 'fabric_moderation',
        title: dto.isPublished ? `“${fabric.name}” is live again` : `“${fabric.name}” was unpublished`,
        body: dto.isPublished
          ? 'AfroCouture reviewed your listing and it is visible in the fabric explorer again.'
          : `AfroCouture took this listing out of the fabric explorer: ${fabric.unpublishedReason}`,
        link: `/merchant/fabrics/${fabric.id}`,
      });
    }
    return { fabric: toAdminFabric(saved), changed };
  }
}
