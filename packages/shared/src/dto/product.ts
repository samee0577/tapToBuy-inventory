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

/**
 * Everything the browser needs to upload one image directly to Cloudinary.
 *
 * `fields` is a complete, signed parameter set. Cloudinary rejects the upload if
 * the signature does not match, so the browser cannot add a parameter of its own
 * or widen `allowed_formats`.
 */
export interface CloudinaryUploadTicketDto {
  uploadUrl: string;
  publicId: string;
  fields: Record<string, string>;
  /** Presented at /api/uploads/complete to prove this upload was authorised. */
  uploadToken: string;
  maxBytes: number;
  allowedFormats: readonly string[];
  acceptedContentTypes: readonly string[];
  expiresInSeconds: number;
}

/**
 * The result of re-reading an uploaded asset from Cloudinary's admin API. The
 * values come from the stored asset, not from what the browser claimed.
 */
export interface VerifiedImageDto {
  imageKey: string;
  imageUrl: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}
