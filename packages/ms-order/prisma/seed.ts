import { PrismaClient } from '../node_modules/.prisma-ms-order/client'
import { seedOrdersIfEmpty } from '../src/seedOrders'

const prisma = new PrismaClient()

// Idempotency: seedOrdersIfEmpty() itself checks `prisma.order.count()` and
// no-ops if the table already has rows, so this script (and the identical
// logic reused at server bootstrap in src/index.ts) is safe to run repeatedly
// without ever producing duplicate orders. We don't do a per-row findUnique
// existence check on top of that since the count guard already makes any
// partial-seed scenario impossible under normal operation.
async function main() {
  const inserted = await seedOrdersIfEmpty(prisma)
  if (inserted === 0) {
    console.log('[ms-order seed] Orders table already populated, skipping seed.')
    return
  }
  console.log(`[ms-order seed] Inserted ${inserted} orders`)
}

main()
  .catch((err) => {
    console.error('[ms-order seed] Error seeding orders:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
