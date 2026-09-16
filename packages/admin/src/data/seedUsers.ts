import type { UserRecord } from '../types';

export const INITIAL_USERS: UserRecord[] = [
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
    createdAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-customer-02',
    email: 'sarah.connor@cyberdyne.com',
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
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-vendor-01',
    email: 'marcus@soundgear.io',
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
    createdAt: new Date().toISOString(),
  },
];
