import { Prisma, type PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import type { UserWithAddresses } from '../userMapping'

export interface ProvisionInput {
  /** Supabase auth.users id (the JWT `sub`). */
  authUserId: string
  email: string
  firstName?: string
  lastName?: string
}

/** Local part of the address, cut to the column rules, as a placeholder first name. */
function placeholderName(email: string): string {
  return email.split('@')[0]?.slice(0, 100) || 'New'
}

/**
 * Returns the profile linked to this Supabase user, creating a CUSTOMER one on
 * first sight. This is how a person who signed up directly with supabase-js gets
 * a row, and the only place a profile is created for an identity we did not make.
 *
 * It links by `auth_user_id` ONLY. It will not adopt an existing row that merely
 * has the same e-mail: that row (e.g. a seeded ADMIN) was never linked to this
 * identity, and adopting it would hand its role to whoever registers the address.
 * That case returns null; `pnpm run auth:sync` is the sanctioned way to link them.
 */
export async function ensureProfile(
  prisma: PrismaClient,
  input: ProvisionInput
): Promise<UserWithAddresses | null> {
  const include = { addresses: true } as const
  const existing = await prisma.user.findUnique({
    where: { authUserId: input.authUserId },
    include,
  })
  if (existing) return existing

  try {
    return await prisma.user.create({
      data: {
        authUserId: input.authUserId,
        email: input.email,
        firstName: input.firstName ?? placeholderName(input.email),
        lastName: input.lastName ?? '',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: false,
      },
      include,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Either two first requests raced (the row now exists) or the e-mail belongs
      // to a row linked to someone else (it does not).
      return prisma.user.findUnique({ where: { authUserId: input.authUserId }, include })
    }
    throw err
  }
}
