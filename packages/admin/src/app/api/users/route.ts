import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

interface UserAddress {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefaultShipping: boolean;
}

export interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'CUSTOMER' | 'VENDOR';
  isActive: boolean;
  isEmailVerified: boolean;
  addresses: UserAddress[];
  createdAt?: string;
}

const DEFAULT_USERS: UserRecord[] = [
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
    email: 'audiomaster@soundgear.io',
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

let inMemoryUsers: UserRecord[] = [...DEFAULT_USERS];

function getUsersFilePath(): string {
  return path.resolve(process.cwd(), '../../data/users.json');
}

function loadUsers(): UserRecord[] {
  try {
    const filePath = getUsersFilePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading users from file, using in-memory fallback:', err);
  }
  return inMemoryUsers;
}

function saveUsers(users: UserRecord[]): void {
  inMemoryUsers = users;
  try {
    const filePath = getUsersFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving users to file:', err);
  }
}

export async function GET() {
  const users = loadUsers();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    total: users.length,
    users,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const users = loadUsers();

    const newUser: UserRecord = {
      id: `user-${Date.now()}`,
      email: body.email || `user-${Date.now()}@ecommerce.com`,
      firstName: body.firstName || 'New',
      lastName: body.lastName || 'User',
      role: body.role || 'CUSTOMER',
      isActive: body.isActive !== undefined ? body.isActive : true,
      isEmailVerified: body.isEmailVerified !== undefined ? body.isEmailVerified : true,
      addresses: body.addresses || [
        {
          addressLine1: body.addressLine1 || '123 Market St',
          city: body.city || 'Seattle',
          state: body.state || 'WA',
          postalCode: body.postalCode || '98101',
          country: body.country || 'United States',
          isDefaultShipping: true,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    users.unshift(newUser);
    saveUsers(users);

    return NextResponse.json({ success: true, user: newUser }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    const users = loadUsers();
    const index = users.findIndex((u) => u.id === body.id);
    if (index === -1) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    users[index] = {
      ...users[index],
      ...body,
    };
    saveUsers(users);

    return NextResponse.json({ success: true, user: users[index] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    let users = loadUsers();
    users = users.filter((u) => u.id !== id);
    saveUsers(users);

    return NextResponse.json({ success: true, message: `User ${id} deleted` });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
