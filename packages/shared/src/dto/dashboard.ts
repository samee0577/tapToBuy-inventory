import type { ProductListItemDto } from './product.js';

export interface DashboardCountDto {
  totalProducts: number;
  activeProducts: number;
  totalVariants: number;
  totalStockUnits: number;
  lowStockVariants: number;
  severeLowStockVariants: number;
  outOfStockVariants: number;
}

export interface DashboardFinancialsDto {
  /** buyingPrice x stockQuantity across active variants. */
  costValue: string;
  /** sellingPrice x stockQuantity across active variants. */
  retailValue: string;
  /** retailValue - costValue. */
  potentialProfit: string;
  unitsSold: number;
  unitsReturned: number;
  /** Realized profit over the selected range: sales minus returns. */
  realizedProfit: string;
}

export interface ActivityActorDto {
  id: string;
  name: string;
  role: string;
}

export interface RecentActivityDto {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  size: string;
  color: string;
  type: string;
  quantity: number;
  newStock: number;
  performedBy: ActivityActorDto;
  createdAt: string;
}

export interface LowStockItemDto {
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  imageUrl: string | null;
  size: string;
  color: string;
  stockQuantity: number;
  stockStatus: string;
}

export interface DashboardBaseDto {
  counts: DashboardCountDto;
  recentActivity: RecentActivityDto[];
  lowStockItems: LowStockItemDto[];
  rangeDays: number;
  generatedAt: string;
}

export interface DashboardAdminDto extends DashboardBaseDto {
  financials: DashboardFinancialsDto;
  /** Present only for ADMIN; omitted entirely for STAFF. */
  topProfitableVariants: Array<ProductListItemDto['variants'][number] & { productName: string }>;
}

export type DashboardDto = DashboardBaseDto | DashboardAdminDto;

export function hasDashboardFinancials(dashboard: DashboardDto): dashboard is DashboardAdminDto {
  return 'financials' in dashboard;
}
