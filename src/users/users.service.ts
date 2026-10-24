import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { UpdateProfileDto } from './dto/set-role.dto.js';
import { KycStatus, UserRole } from '../types/index.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { Order } from '../orders/entities/order.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TailorProfile)
    private readonly tailors: Repository<TailorProfile>,
    @InjectRepository(MerchantProfile)
    private readonly merchants: Repository<MerchantProfile>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /**
   * Self-service role choice during onboarding. Once the account is committed to a role — a
   * profile submitted for review, or any order — switching would carry access across roles,
   * so it needs support instead. Admins never change role here.
   */
  async setRole(user: User, role: UserRole): Promise<User> {
    if (user.role === role) {
      // Choosing the role they already have still completes the "choose your path" step.
      if (!user.pathChosenAt) {
        user.pathChosenAt = new Date();
        return this.userRepository.save(user);
      }
      return user;
    }
    if (user.role === UserRole.ADMIN) throw new ForbiddenException('Admin accounts cannot change role.');

    const [submittedTailor, submittedMerchant, hasOrders] = await Promise.all([
      this.tailors.exists({ where: { userId: user.id, kycStatus: Not(KycStatus.DRAFT) } }),
      this.merchants.exists({ where: { userId: user.id, verificationStatus: Not(KycStatus.DRAFT) } }),
      this.orders.exists({ where: [{ customerId: user.id }, { tailorUserId: user.id }] }),
    ]);
    if (submittedTailor || submittedMerchant || hasOrders) {
      throw new ConflictException({
        code: 'ROLE_LOCKED',
        message: 'Your account is already set up for its current role. Contact support to change it.',
      });
    }
    user.role = role;
    user.pathChosenAt ??= new Date();
    return this.userRepository.save(user);
  }

  async updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) user.phone = dto.phone.trim();
    return this.userRepository.save(user);
  }
}
