/**
 * Stock status thresholds are deliberately NOT configurable per variant (§17).
 * They live here as documented application constants so that changing the
 * policy is a single, reviewable edit rather than a schema migration.
 */
export const StockStatus = {
  IN_STOCK: 'IN_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
} as const;

export type StockStatus = (typeof StockStatus)[keyof typeof StockStatus];

/** At or below this many units a variant is flagged LOW_STOCK. */
export const LOW_STOCK_MAX_UNITS = 5;

/** At or below this many units a variant is flagged critical on the dashboard. */
export const LOW_STOCK_SEVERE_MAX_UNITS = 2;

export function deriveStockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return StockStatus.OUT_OF_STOCK;
  if (quantity <= LOW_STOCK_MAX_UNITS) return StockStatus.LOW_STOCK;
  return StockStatus.IN_STOCK;
}

export function isLowStock(quantity: number): boolean {
  return quantity > 0 && quantity <= LOW_STOCK_MAX_UNITS;
}

export function isSevereLowStock(quantity: number): boolean {
  return quantity > 0 && quantity <= LOW_STOCK_SEVERE_MAX_UNITS;
}

/**
 * Translates a stock status into the numeric range that produces it.
 *
 * Stock status is derived, never stored, so a query filtering by it has to
 * restate the rule as a range. Keeping the two definitions adjacent is what stops
 * the filter and the displayed badge from disagreeing.
 */
export function stockStatusToRange(status: StockStatus): { gt?: number; lte?: number } {
  switch (status) {
    case StockStatus.OUT_OF_STOCK:
      return { lte: 0 };
    case StockStatus.LOW_STOCK:
      return { gt: 0, lte: LOW_STOCK_MAX_UNITS };
    case StockStatus.IN_STOCK:
      return { gt: LOW_STOCK_MAX_UNITS };
  }
}

/**
 * Upper bound on a single movement's quantity. Guards against a fat-fingered
 * STOCK_IN of 10^9 units and keeps `previousStock + quantity` inside Int32.
 */
export const MAX_MOVEMENT_QUANTITY = 100_000;

/** Ceiling for on-hand stock, chosen so Int32 arithmetic can never overflow. */
export const MAX_STOCK_QUANTITY = 2_000_000_000;
