import type { InventoryMovementType } from '../domain.js';
import type { AuditStampDto } from './user.js';

export interface MovementBaseDto {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  productImageUrl: string | null;
  size: string;
  color: string;
  type: InventoryMovementType;
  /** Always a positive magnitude; direction is encoded by previous/new stock. */
  quantity: number;
  previousStock: number;
  newStock: number;
  /** Signed effect on stock, for unambiguous rendering. */
  stockDelta: number;
  reason: string | null;
  note: string | null;
  performedBy: AuditStampDto;
  createdAt: string;
}

export interface MovementFinancialsDto {
  buyingPriceSnapshot: string | null;
  sellingPriceSnapshot: string | null;
  unitProfit: string | null;
  /** quantity x unitProfit, signed by movement type. Null when not applicable. */
  profit: string | null;
}

export interface MovementAdminDto extends MovementBaseDto, MovementFinancialsDto {}

export type MovementDto = MovementBaseDto | MovementAdminDto;

export function hasMovementFinancials(movement: MovementDto): movement is MovementAdminDto {
  return 'profit' in movement;
}

/** Result of a stock operation, returned so the UI can reconcile optimistically. */
export interface StockOperationResultDto {
  movement: MovementDto;
  variant: {
    id: string;
    stockQuantity: number;
    stockStatus: string;
    updatedAt: string;
  };
}
