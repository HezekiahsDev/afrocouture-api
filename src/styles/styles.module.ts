import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Style } from './entities/style.entity.js';

@Injectable()
export class StylesService {
  constructor(@InjectRepository(Style) private readonly styleRepository: Repository<Style>) {}

  list(): Promise<Style[]> {
    return this.styleRepository.find({
      where: { isPublished: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }
}

@Controller('styles')
export class StylesController {
  constructor(private readonly stylesService: StylesService) {}

  @Get()
  list() {
    return this.stylesService.list();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Style])],
  controllers: [StylesController],
  providers: [StylesService],
})
export class StylesModule {}
