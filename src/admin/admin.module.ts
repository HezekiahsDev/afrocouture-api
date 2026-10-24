import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Module,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ReviewDecisionDto } from '../common/dto/review.dto.js';
import { KycStatus, UserRole } from '../types/index.js';
import { TailorsModule } from '../tailors/tailors.module.js';
import { TailorsService } from '../tailors/tailors.service.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { MerchantsService } from '../merchants/merchants.service.js';

/** Verification queue for artisans and merchants. Admin accounts are created with `pnpm admin:create`. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly tailors: TailorsService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get('verifications')
  async verifications(
    @Query('status', new DefaultValuePipe(KycStatus.PENDING), new ParseEnumPipe(KycStatus)) status: KycStatus,
  ) {
    const [tailors, merchants] = await Promise.all([
      this.tailors.listForReview(status),
      this.merchants.listForReview(status),
    ]);
    return { tailors, merchants };
  }

  @Patch('tailors/:id/review')
  reviewTailor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    return this.tailors.review(id, dto);
  }

  @Patch('merchants/:id/review')
  reviewMerchant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    return this.merchants.review(id, dto);
  }
}

@Module({
  imports: [TailorsModule, MerchantsModule],
  controllers: [AdminController],
})
export class AdminModule {}
