import type { UserRole } from '../domain.js';

export interface SessionUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /**
   * True while the account is still on an administrator-issued temporary
   * password. The frontend surfaces this as a persistent reminder; the API does
   * not block on it, so a user is never trapped out of recording stock.
   */
  mustChangePassword: boolean;
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
