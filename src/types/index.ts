// AfroCouture AI — Backend Domain Types & Enums

export enum UserRole {
  CUSTOMER = 'customer',
  TAILOR = 'tailor',
  MERCHANT = 'merchant',
  ADMIN = 'admin',
}

export enum OrderStatus {
  PENDING = 'pending',
  CUTTING = 'cutting',
  FITTING = 'fitting',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
}

export enum KycStatus {
  /** Saved but not yet submitted for review. */
  DRAFT = 'draft',
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum MeasurementUnit {
  INCHES = 'in',
  CENTIMETERS = 'cm',
}

export enum EscrowStatus {
  HELD = 'held',
  RELEASED = 'released',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

export type DrapeSilhouette = 'slim_modern' | 'classic_regal' | 'relaxed_casual';

export interface MeasurementProfileData {
  chest: number;
  shoulderWidth: number;
  sleeveLength: number;
  kaftanLength: number;
  waist: number;
  neck: number;
  drapeSilhouette: DrapeSilhouette;
  unit: MeasurementUnit;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

