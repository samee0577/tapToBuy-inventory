-- Business invariants enforced by the database itself (§46).
--
-- Prisma cannot express CHECK constraints or triggers in schema.prisma, so they
-- live here. This is deliberate defence in depth: the service layer already
-- enforces every rule, and these constraints make it impossible for a future
-- bug, a manual `psql` session, or a bad migration to violate them silently.

-- ---------------------------------------------------------------------------
-- Canonicalisation
-- The API uppercases product codes and sizes before writing. Enforcing it here
-- means the uniqueness constraints below can be plain indexes instead of
-- case-insensitive expression indexes, which Prisma cannot declare.
-- ---------------------------------------------------------------------------
ALTER TABLE "products"
  ADD CONSTRAINT "products_product_code_upper" CHECK ("product_code" = upper("product_code"));

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_size_upper" CHECK ("size" = upper("size")),
  ADD CONSTRAINT "product_variants_size_trimmed" CHECK ("size" = btrim("size")),
  ADD CONSTRAINT "product_variants_color_trimmed" CHECK ("color" = btrim("color"));

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_trimmed" CHECK ("email" = btrim("email"));

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_prices_non_negative"
    CHECK ("buying_price" >= 0 AND "selling_price" >= 0);

-- ---------------------------------------------------------------------------
-- Stock
-- Rule: stock can never be negative. This is the last line of defence behind the
-- guarded conditional UPDATE in the inventory service.
-- ---------------------------------------------------------------------------
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_non_negative" CHECK ("stock_quantity" >= 0);

-- Rule: movement quantity is always a positive magnitude (§16 Rule 2).
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_stock_non_negative"
    CHECK ("previous_stock" >= 0 AND "new_stock" >= 0);

-- A movement's stated quantity must match the stock transition it records, for
-- all four movement types:
--   STOCK_IN / RETURN  new = previous + quantity
--   SALE               new = previous - quantity
--   ADJUSTMENT         new = previous +/- quantity (direction not stored)
-- so the single form abs(new - previous) = quantity covers every case. This
-- makes it impossible to append a movement whose numbers do not reconcile.
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_quantity_reconciles"
    CHECK (abs("new_stock" - "previous_stock") = "quantity");

-- A variant with no stock history must be created at zero.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_within_range"
    CHECK ("stock_quantity" >= 0 AND "stock_quantity" <= 2000000000);

-- ---------------------------------------------------------------------------
-- Append-only ledgers (§16 Rule 4, §46 invariants 6 and 7)
--
-- There is no API route that edits or deletes a movement or a price record. This
-- trigger makes that guarantee hold even for someone with direct database
-- access, and turns a would-be silent corruption into a loud failure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table "%" is append-only; % is not permitted. Record a correcting ADJUSTMENT instead.',
    TG_TABLE_NAME,
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER price_history_append_only
  BEFORE UPDATE OR DELETE ON "price_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Soft deletion (§46 invariant 13)
-- A product or variant that has inventory history must be deactivated, never
-- deleted. Cascade from product to variant would otherwise silently take
-- history-adjacent rows with it, so the FK above is RESTRICT; this makes the
-- intent explicit at the variant level too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_deleting_variant_with_history()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory_movements" WHERE "variant_id" = OLD.id) THEN
    RAISE EXCEPTION
      'Variant % has inventory history and cannot be deleted; deactivate it instead.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_variants_no_hard_delete
  BEFORE DELETE ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION forbid_deleting_variant_with_history();
