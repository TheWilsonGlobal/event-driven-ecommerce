import { PrismaClient } from '@prisma/client'
import { SEED_USERS } from '@ecommerce/shared-database'

const prisma = new PrismaClient()

/**
 * Idempotently seeds the users table from the shared SEED_USERS source of
 * truth. Skips entirely if any users already exist, so repeat runs (manual
 * `pnpm run db:seed`, `prisma migrate dev`, or service bootstrap) never
 * duplicate data.
 */
export async function seedUsers(): Promise<{ inserted: number; skipped: boolean }> {
  const existingCount = await prisma.user.count()
  if (existingCount > 0) {
    console.log(
      `[ms-user seed] Skipping seed: ${existingCount} user(s) already present.`
    )
    return { inserted: 0, skipped: true }
  }

  let inserted = 0
  for (const seedUser of SEED_USERS) {
    await prisma.user.create({
      data: {
        id: seedUser.id,
        email: seedUser.email,
        passwordHash: seedUser.passwordHash,
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        role: seedUser.role,
        isActive: seedUser.isActive,
        isEmailVerified: seedUser.isEmailVerified,
        addresses: {
          create: seedUser.addresses.map((address) => ({
            addressLine1: address.addressLine1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: address.country,
            isDefaultShipping: address.isDefaultShipping,
          })),
        },
      },
    })
    inserted += 1
  }

  console.log(`[ms-user seed] Inserted ${inserted} user(s) from SEED_USERS.`)
  return { inserted, skipped: false }
}

async function main() {
  try {
    await seedUsers()
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[ms-user seed] Error seeding users:', err)
    process.exit(1)
  })
}
