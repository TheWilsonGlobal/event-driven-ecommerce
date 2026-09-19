import type { PrismaClient } from '../node_modules/.prisma-ms-user/client'
import type { User, UserRole } from '@ecommerce/shared-types'

type PrismaUser = Awaited<ReturnType<InstanceType<typeof PrismaClient>['user']['findFirstOrThrow']>>

export type UserWithAddresses = PrismaUser & {
  addresses: Array<{
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string
    postalCode: string
    country: string
    isDefaultShipping: boolean
    isDefaultBilling: boolean
  }>
}

/** Maps a Prisma User (with addresses included) to the public API shape, dropping passwordHash. */
export function toPublicUser(user: UserWithAddresses): User {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    // user.role is an untyped Prisma String column — this mapping is the
    // trusted boundary where it's asserted into the shared UserRole contract.
    role: user.role as UserRole,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    addresses: user.addresses.map((address) => ({
      addressLine1: address.addressLine1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isDefaultShipping: address.isDefaultShipping,
    })),
    createdAt: user.createdAt.toISOString(),
  }
}
