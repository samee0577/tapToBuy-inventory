import type { UserRole } from '../domain.js';

export interface SessionUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface UserDto extends SessionUserDto {
  isActive: boolean;
  /** Never includes the hash — the API has no reason to emit it. */
  hasPassword: boolean;
  hasGoogleAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditStampDto {
  id: string;
  name: string;
  role: UserRole;
}
