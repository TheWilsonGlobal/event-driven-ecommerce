/*
  Warnings:

  - Added the required column `customer_email` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customer_name` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL NOT NULL,
    "tax_amount" DECIMAL NOT NULL DEFAULT 0.00,
    "shipping_amount" DECIMAL NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shipping_address" TEXT NOT NULL,
    "billing_address" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_orders" ("billing_address", "created_at", "currency", "discount_amount", "id", "idempotency_key", "order_number", "shipping_address", "shipping_amount", "status", "subtotal", "tax_amount", "total_amount", "updated_at", "user_id") SELECT "billing_address", "created_at", "currency", "discount_amount", "id", "idempotency_key", "order_number", "shipping_address", "shipping_amount", "status", "subtotal", "tax_amount", "total_amount", "updated_at", "user_id" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
