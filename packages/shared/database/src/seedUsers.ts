export interface SeedUser {
  id: string
  email: string
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
]
