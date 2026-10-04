export const UserRole = {
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.STAFF];

export function isAdmin(role: UserRole): boolean {
  return role === UserRole.ADMIN;
}

export const InventoryMovementType = {
  STOCK_IN: 'STOCK_IN',
  SALE: 'SALE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType];

export const INVENTORY_MOVEMENT_TYPES: readonly InventoryMovementType[] = [
  InventoryMovementType.STOCK_IN,
  InventoryMovementType.SALE,
  InventoryMovementType.RETURN,
  InventoryMovementType.ADJUSTMENT,
];

/**
 * Movement types that reduce stock on hand. Held as data rather than branching
 * inline so the inventory engine has one source of truth for direction and sign.
 */
export const OUTFLOW_MOVEMENT_TYPES: ReadonlySet<InventoryMovementType> = new Set([
  InventoryMovementType.SALE,
]);

/**
 * Movement types that affect realized profit. SALE adds profit; RETURN subtracts
 * it, because a returned unit becomes sellable stock again.
 */
export const PROFIT_BEARING_MOVEMENT_TYPES: ReadonlySet<InventoryMovementType> = new Set([
  InventoryMovementType.SALE,
  InventoryMovementType.RETURN,
]);

/** Signed effect of a movement type on stock on hand. */
export function stockDirection(type: InventoryMovementType): -1 | 1 {
  return OUTFLOW_MOVEMENT_TYPES.has(type) ? -1 : 1;
}

/** Signed effect of a movement type on realized profit. */
export function profitDirection(type: InventoryMovementType): -1 | 1 {
  return type === InventoryMovementType.RETURN ? -1 : 1;
}
