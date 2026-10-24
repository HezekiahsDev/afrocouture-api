import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { UpdateProfileDto } from './dto/set-role.dto.js';
import { UserRole } from '../types/index.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async setRole(user: User, role: UserRole): Promise<User> {
    user.role = role;
    return this.userRepository.save(user);
  }

  async updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) user.phone = dto.phone.trim();
    return this.userRepository.save(user);
  }
}
