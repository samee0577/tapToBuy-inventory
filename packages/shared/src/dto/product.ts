import type { StockStatus } from '../constants/stock.js';
import type { AuditStampDto } from './user.js';

/** Financial fields that must never reach a STAFF client. */
export interface VariantFinancialsDto {
  buyingPrice: string;
  unitProfit: string;
  marginPercent: string;
}

export interface VariantBaseDto {
  id: string;
  productId: string;
  size: string;
  color: string;
  sellingPrice: string;
  stockQuantity: number;
  stockStatus: StockStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VariantAdminDto extends VariantBaseDto, VariantFinancialsDto {}

export type VariantDto = VariantBaseDto | VariantAdminDto;

/**
 * Narrows a VariantDto to the admin shape. The serialiser builds these objects,
 * so `buyingPrice` is absent — not merely hidden — from every STAFF payload.
 */
export function hasVariantFinancials(variant: VariantDto): variant is VariantAdminDto {
  return 'buyingPrice' in variant;
}

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImageDto {
  imageKey: string;
  imageUrl: string;
}

export interface ProductBaseDto {
  id: string;
  name: string;
  productCode: string;
  categoryId: string;
  categoryName: string;
  imageKey: string | null;
  imageUrl: string | null;
  description: string | null;
  isActive: boolean;
  variantCount: number;
  totalStock: number;
  stockStatus: StockStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItemDto extends ProductBaseDto {
  variants: VariantDto[];
}

export interface ProductDetailDto extends ProductBaseDto {
  variants: VariantDto[];
  createdBy: AuditStampDto | null;
}

/** Admin-only price change log. */
export interface PriceHistoryEntryDto {
  id: string;
  variantId: string;
  size: string;
  color: string;
  oldBuyingPrice: string | null;
  newBuyingPrice: string;
  oldSellingPrice: string | null;
  newSellingPrice: string;
  changedBy: AuditStampDto;
  changedAt: string;
}

export interface PriceHistoryDto {
  variantId: string;
  currentBuyingPrice: string;
  currentSellingPrice: string;
  entries: PriceHistoryEntryDto[];
}

/** A short-lived R2 PUT target handed to the browser for direct upload. */
export interface PresignedUploadDto {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresInSeconds: number;
  requiredHeaders: Record<string, string>;
  maxBytes: number;
}
