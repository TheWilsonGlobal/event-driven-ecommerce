/**
 * Creates the Supabase Auth accounts for profile rows that have none, and links
 * them (users.auth_user_id).
 *
 *   pnpm run auth:sync             DRY RUN: prints what would happen, calls nothing
 *   pnpm run auth:sync -- --apply  creates / links accounts through the Admin API
 *
 * --apply WRITES TO SUPABASE AUTH. It needs:
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   (root .env)
 *   SEED_USER_PASSWORD                  at least 12 characters; there is no default
 *                                       and the value is never printed or stored
 *
 * Every created account is confirmed (email_confirm: true) and carries
 * app_metadata.app_role, so the first token already has the role. An account that
 * already exists in Supabase for the same e-mail is LINKED, never modified except
 * for its role and ban state: its password is left alone.
 *
 * Idempotent: rows that already have an auth_user_id are skipped.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import { loadDatabaseConfig } from '@ecommerce/shared-database'
import { PrismaClient } from '../node_modules/.prisma-ms-user/client'
import {
  SupabaseAuthError,
  createSupabaseAuth,
  loadSupabaseConfig,
  type SupabaseAuth,
} from '../src/supabase'

dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

// The Prisma schema reads USER_DATABASE_URL / USER_DIRECT_URL, which the root .env only
// implies through SUPABASE_DB_URL. loadDatabaseConfig derives them into process.env (the
// same applyServiceUrlDefaults the service itself runs) before PrismaClient is built.
loadDatabaseConfig(process.env)

const MIN_PASSWORD_LENGTH = 12
const PAGE_SIZE = 200
const MAX_PAGES = 50

const log = (line: string) => process.stdout.write(`${line}\n`)

async function existingAccounts(supabase: SupabaseAuth): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const users = await supabase.admin.listUsers(page, PAGE_SIZE)
    for (const u of users) if (u.email) byEmail.set(u.email, u.id)
    if (users.length < PAGE_SIZE) break
  }
  return byEmail
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.user.findMany({
      where: { authUserId: null },
      orderBy: { createdAt: 'asc' },
    })
    log(`${rows.length} profile row(s) without a Supabase account.`)

    if (!apply) {
      for (const r of rows) {
        log(`  would sync  ${r.email}  role=${r.role}  active=${r.isActive}`)
      }
      log('Dry run: nothing was changed. Re-run with --apply to create / link accounts.')
      return 0
    }

    const password = process.env.SEED_USER_PASSWORD ?? ''
    if (password.length < MIN_PASSWORD_LENGTH) {
      log(
        `Refusing to apply: SEED_USER_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters.`
      )
      return 1
    }
    const config = loadSupabaseConfig()
    if (!config.url || !config.secretKey) {
      log('Refusing to apply: SUPABASE_URL and SUPABASE_SECRET_KEY must be set.')
      return 1
    }
    const supabase = createSupabaseAuth(config)
    const known = await existingAccounts(supabase)

    let created = 0
    let linked = 0
    let failed = 0
    for (const r of rows) {
      const email = r.email.toLowerCase()
      try {
        let id = known.get(email)
        if (id) {
          await supabase.admin.updateUser(id, { appRole: r.role, banned: !r.isActive })
          linked += 1
          log(`  linked   ${email}`)
        } else {
          ;({ id } = await supabase.admin.createUser({
            email,
            emailConfirm: true,
            appRole: r.role,
            firstName: r.firstName,
            lastName: r.lastName,
            password,
          }))
          if (!r.isActive) await supabase.admin.updateUser(id, { banned: true })
          created += 1
          log(`  created  ${email}`)
        }
        await prisma.user.update({ where: { id: r.id }, data: { authUserId: id } })
      } catch (err) {
        failed += 1
        log(`  FAILED   ${email}  (${err instanceof SupabaseAuthError ? err.kind : 'error'})`)
      }
    }
    log(`Done: ${created} created, ${linked} linked, ${failed} failed.`)
    return failed > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`auth:sync failed: ${err instanceof Error ? err.name : 'error'}`)
    process.exit(1)
  }
)
