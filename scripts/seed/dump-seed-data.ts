import * as fs from 'fs'
import * as path from 'path'
import { SEED_CATEGORIES, SEED_PRODUCTS, SEED_USERS, SEED_ORDERS } from '@ecommerce/shared-database'

// Dumps the shared seed constants (the same data each service self-seeds
// into its own real DB on boot) to JSON files under data/ for inspection —
// nothing in the apps reads these files back at runtime.
export async function runSeed(outputDir: string = path.resolve(__dirname, '../../data')) {
  console.log('🚀 [Seed] Initializing E-Commerce database seed process...')

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const productsFile = path.join(outputDir, 'products.json')
  const categoriesFile = path.join(outputDir, 'categories.json')
  const usersFile = path.join(outputDir, 'users.json')
  const ordersFile = path.join(outputDir, 'orders.json')

  fs.writeFileSync(productsFile, JSON.stringify(SEED_PRODUCTS, null, 2), 'utf8')
  fs.writeFileSync(categoriesFile, JSON.stringify(SEED_CATEGORIES, null, 2), 'utf8')
  fs.writeFileSync(usersFile, JSON.stringify(SEED_USERS, null, 2), 'utf8')
  fs.writeFileSync(ordersFile, JSON.stringify(SEED_ORDERS, null, 2), 'utf8')

  console.log(`✅ [Seed] Successfully seeded:`)
  console.log(`   - ${SEED_CATEGORIES.length} Categories -> ${categoriesFile}`)
  console.log(`   - ${SEED_PRODUCTS.length} Products -> ${productsFile}`)
  console.log(`   - ${SEED_USERS.length} Users -> ${usersFile}`)
  console.log(`   - ${SEED_ORDERS.length} Orders -> ${ordersFile}`)
  console.log(`✨ [Seed] Database seeding completed successfully!`)
}

if (require.main === module) {
  runSeed().catch((err) => {
    console.error('❌ [Seed] Error seeding data:', err)
    process.exit(1)
  })
}
