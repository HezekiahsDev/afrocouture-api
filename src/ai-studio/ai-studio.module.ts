import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiDesign } from './entities/ai-design.entity.js';
import { AiStudioController } from './ai-studio.controller.js';
import { AiStudioService } from './ai-studio.service.js';
import { ImagenClient } from './imagen.client.js';
import { UploadsModule } from '../uploads/uploads.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiDesign]), UploadsModule],
  controllers: [AiStudioController],
  providers: [AiStudioService, ImagenClient],
  exports: [AiStudioService],
})
export class AiStudioModule {}
