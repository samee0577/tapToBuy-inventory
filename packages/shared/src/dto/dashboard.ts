import type { StockStatus } from '../constants/stock.js';

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
  stockStatus: StockStatus;
}

export interface DashboardBaseDto {
  counts: DashboardCountDto;
  recentActivity: RecentActivityDto[];
  lowStockItems: LowStockItemDto[];
  rangeDays: number;
  generatedAt: string;
}

/**
 * One row of the dashboard's top-earners list.
 *
 * Deliberately not a `VariantDto`. This list answers "what made the most money",
 * which needs the units sold and the profit — not the variant's audit timestamps,
 * active flag or current margin. Reusing the variant shape would drag those along
 * and then compute figures nobody displays.
 */
export interface TopVariantDto {
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  imageUrl: string | null;
  size: string;
  color: string;
  sellingPrice: string;
  stockQuantity: number;
  unitsSold: number;
  /** Realized over the selected range, from frozen movement snapshots. */
  profit: string;
}

export interface DashboardAdminDto extends DashboardBaseDto {
  financials: DashboardFinancialsDto;
  /** Present only for ADMIN; omitted entirely for STAFF. */
  topProfitableVariants: TopVariantDto[];
}

export type DashboardDto = DashboardBaseDto | DashboardAdminDto;

export function hasDashboardFinancials(dashboard: DashboardDto): dashboard is DashboardAdminDto {
  return 'financials' in dashboard;
}
