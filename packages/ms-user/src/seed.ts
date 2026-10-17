import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '../node_modules/.prisma-ms-user/client'
import { SEED_USERS } from '@ecommerce/shared-database'

import * as fs from 'fs'
import * as path from 'path'

async function ensureTables(server: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../prisma/migrations')
  if (fs.existsSync(migrationsDir)) {
    const entries = fs.readdirSync(migrationsDir).sort()
    for (const entry of entries) {
      const sqlFile = path.join(migrationsDir, entry, 'migration.sql')
      if (fs.existsSync(sqlFile)) {
        server.log.info(`[ms-user] Applying migration: ${entry}`)
        const sql = fs.readFileSync(sqlFile, 'utf8')
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
        for (const statement of statements) {
          await prisma.$executeRawUnsafe(statement)
        }
      }
    }
  }
}

/**
 * Self-seeds the users table from the shared SEED_USERS source of truth if
 * (and only if) it is currently empty. Safe to call on every service start:
 * restarts never duplicate data since it no-ops once users exist.
 *
 * Profiles only: credentials live in Supabase Auth now, so no password hash is
 * written (SEED_USERS still carries one for the other consumers of that list).
 * The rows start with no auth_user_id; `pnpm run auth:sync` creates the matching
 * Supabase accounts and links them.
 */
export async function seedIfEmpty(server: FastifyInstance, prisma: PrismaClient): Promise<void> {
  try {
    const existingCount = await prisma.user.count()
    if (existingCount > 0) {
      server.log.info(`[ms-user] Skipping seed: ${existingCount} user(s) already present.`)
      return
    }
  } catch (err: any) {
    if (err?.code === 'P2021') {
      server.log.warn('[ms-user] Users table missing, initializing schema from migrations...')
      await ensureTables(server, prisma)
    } else {
      throw err
    }
  }

  let inserted = 0
  for (const seedUser of SEED_USERS) {
    await prisma.user.create({
      data: {
        id: seedUser.id,
        email: seedUser.email,
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

  server.log.info(`[ms-user] Seeded ${inserted} user(s) from SEED_USERS.`)
}
