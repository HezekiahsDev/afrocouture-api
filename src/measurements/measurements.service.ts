import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerFitProfile } from './entities/customer-fit-profile.entity.js';
import { SaveMeasurementsDto } from './dto/save-measurements.dto.js';
import { User } from '../users/entities/user.entity.js';
import { definedOnly } from '../common/defined-only.js';

@Injectable()
export class MeasurementsService {
  constructor(
    @InjectRepository(CustomerFitProfile)
    private readonly fitProfileRepository: Repository<CustomerFitProfile>,
  ) {}

  findMine(user: User): Promise<CustomerFitProfile | null> {
    return this.fitProfileRepository.findOne({ where: { userId: user.id } });
  }

  async saveMine(user: User, dto: SaveMeasurementsDto): Promise<CustomerFitProfile> {
    const profile =
      (await this.findMine(user)) ?? this.fitProfileRepository.create({ userId: user.id });
    Object.assign(profile, definedOnly(dto));
    return this.fitProfileRepository.save(profile);
  }
}
