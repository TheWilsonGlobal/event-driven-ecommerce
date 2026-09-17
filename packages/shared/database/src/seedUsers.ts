// Dev-only bcrypt hash of the plaintext password "Password123!" (10 salt rounds).
// Shared across all seed users so local/dev login can be tested with one known
// credential pair. Generated once via bcryptjs; shared-database does not take a
// runtime bcrypt dependency itself, this is just the resulting hash string.
export const SEED_USER_DEV_PASSWORD_HASH =
  '$2a$10$mtbGEhr4qwZ59/gd7tpHR.6rz4wTaVJvOESWRd/vyYy.3ACOnrOPi'

export interface SeedUser {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  role: 'CUSTOMER' | 'ADMIN' | 'VENDOR'
  isActive: boolean
  isEmailVerified: boolean
  addresses: {
    addressLine1: string
    city: string
    state: string
    postalCode: string
    country: string
    isDefaultShipping: boolean
  }[]
}

export const SEED_USERS: SeedUser[] = [
  {
    id: 'user-admin-01',
    email: 'admin@ecommerce.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Platform',
    lastName: 'Admin',
    role: 'ADMIN',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '100 Silicon Valley Way',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-customer-01',
    email: 'customer@ecommerce.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Alex',
    lastName: 'Morgan',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'OR',
        postalCode: '97477',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-customer-02',
    email: 'sarah.connor@cyberdyne.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Sarah',
    lastName: 'Connor',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '214 Desert Highway',
        city: 'Mojave',
        state: 'CA',
        postalCode: '93501',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-customer-03',
    email: 'priya.natarajan@example.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Priya',
    lastName: 'Natarajan',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '88 Lakeshore Drive',
        city: 'Chicago',
        state: 'IL',
        postalCode: '60601',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-customer-04',
    email: 'derek.whitfield@example.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Derek',
    lastName: 'Whitfield',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: false,
    addresses: [
      {
        addressLine1: '19 Birchwood Lane',
        city: 'Portland',
        state: 'ME',
        postalCode: '04101',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-customer-05',
    email: 'maria.gutierrez@example.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Maria',
    lastName: 'Gutierrez',
    role: 'CUSTOMER',
    isActive: false,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '4520 Sunset Boulevard',
        city: 'Miami',
        state: 'FL',
        postalCode: '33139',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-vendor-01',
    email: 'marcus@soundgear.io',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Marcus',
    lastName: 'Vance',
    role: 'VENDOR',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '500 Acoustic Blvd',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
  {
    id: 'user-vendor-02',
    email: 'linh.tran@homegoods-collective.com',
    passwordHash: SEED_USER_DEV_PASSWORD_HASH,
    firstName: 'Linh',
    lastName: 'Tran',
    role: 'VENDOR',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '77 Harborview Street',
        city: 'Seattle',
        state: 'WA',
        postalCode: '98101',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
  },
]
