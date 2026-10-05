import type { InventoryMovementType } from '../domain.js';
import type { StockStatus } from '../constants/stock.js';
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

export interface InventoryRowBaseDto {
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  size: string;
  color: string;
  sellingPrice: string;
  stockQuantity: number;
  /**
   * Derived, not stored, and sent by the server so the badge on this row and the
   * `?stockStatus=` filter that produced it can never disagree about the thresholds.
   */
  stockStatus: StockStatus;
  /** sellingPrice x stockQuantity, in money. */
  stockValue: string;
  isActive: boolean;
  productIsActive: boolean;
  updatedAt: string;
}

export interface InventoryRowAdminDto extends InventoryRowBaseDto {
  buyingPrice: string;
  /** buyingPrice x stockQuantity, in money. */
  stockCostValue: string;
}

export type InventoryRowDto = InventoryRowBaseDto | InventoryRowAdminDto;

export function hasInventoryCost(row: InventoryRowDto): row is InventoryRowAdminDto {
  return 'buyingPrice' in row;
}

/** Distinct filter values, so the drawer needs no second request to populate. */
export interface InventoryFacetsDto {
  sizes: string[];
  colors: string[];
}

/**
 * Headline figures for the dashboard header. Money strings, because every money
 * value on the wire is.
 */
export interface InventorySummaryDto {
  totalVariants: number;
  totalStockUnits: number;
  lowStockVariants: number;
  severeLowStockVariants: number;
  outOfStockVariants: number;
  costValue: string;
  retailValue: string;
  potentialProfit: string;
}
