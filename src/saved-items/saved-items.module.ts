import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { SavedItem, SavedItemType } from './entities/saved-item.entity.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { Fabric } from '../fabrics/entities/fabric.entity.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';

export class SaveItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  quantity?: number;
}

@Injectable()
export class SavedItemsService {
  constructor(
    @InjectRepository(SavedItem) private readonly savedRepository: Repository<SavedItem>,
    @InjectRepository(TailorProfile) private readonly tailorRepository: Repository<TailorProfile>,
    @InjectRepository(Fabric) private readonly fabricRepository: Repository<Fabric>,
  ) {}

  list(user: User): Promise<SavedItem[]> {
    return this.savedRepository.find({ where: { userId: user.id }, order: { createdAt: 'DESC' } });
  }

  async save(user: User, itemType: SavedItemType, itemId: string, quantity?: number): Promise<SavedItem> {
    const exists =
      itemType === SavedItemType.TAILOR
        ? await this.tailorRepository.exists({ where: { id: itemId } })
        : await this.fabricRepository.exists({ where: { id: itemId } });
    if (!exists) throw new NotFoundException(`That ${itemType} no longer exists.`);

    const existing = await this.savedRepository.findOne({ where: { userId: user.id, itemType, itemId } });
    const item = existing ?? this.savedRepository.create({ userId: user.id, itemType, itemId });
    item.quantity = itemType === SavedItemType.FABRIC ? (quantity ?? item.quantity ?? 1) : null;
    return this.savedRepository.save(item);
  }

  async remove(user: User, itemType: SavedItemType, itemId: string): Promise<void> {
    await this.savedRepository.delete({ userId: user.id, itemType, itemId });
  }
}

@Controller('saved')
@UseGuards(JwtAuthGuard)
export class SavedItemsController {
  constructor(private readonly savedItems: SavedItemsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.savedItems.list(user);
  }

  @Put(':itemType/:itemId')
  save(
    @CurrentUser() user: User,
    @Param('itemType', new ParseEnumPipe(SavedItemType)) itemType: SavedItemType,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SaveItemDto,
  ) {
    return this.savedItems.save(user, itemType, itemId, dto.quantity);
  }

  @Delete(':itemType/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('itemType', new ParseEnumPipe(SavedItemType)) itemType: SavedItemType,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.savedItems.remove(user, itemType, itemId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([SavedItem, TailorProfile, Fabric])],
  controllers: [SavedItemsController],
  providers: [SavedItemsService],
})
export class SavedItemsModule {}
