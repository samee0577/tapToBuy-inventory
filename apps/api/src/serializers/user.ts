import type { SessionUserDto, UserDto } from '@inventory/shared';

/** The exact columns auth middleware selects; never widen this at the call site. */
export interface UserAuthRecord {
  id: string;
  name: string;
  email: string;
  role: SessionUserDto['role'];
  isActive: boolean;
  passwordHash: string | null;
  googleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const AUTH_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  passwordHash: true,
  googleId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toSessionUser(user: UserAuthRecord): SessionUserDto {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * The password hash and Google subject are deliberately not part of UserDto.
 * There is no code path that can serialise them, so no future controller can
 * leak them by forgetting to strip a field.
 */
export function toUserDto(user: UserAuthRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    hasPassword: user.passwordHash !== null,
    hasGoogleAccount: user.googleId !== null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
