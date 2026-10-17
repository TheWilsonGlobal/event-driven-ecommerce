import { USER_ROLES } from '@ecommerce/shared-types'
import { Email, EntityId, Password, Str, Strict, Type } from '@ecommerce/shared-security'

/**
 * Every request and response contract of ms-user, in one place.
 *
 * Rules applied throughout: bodies are `Strict` (unknown fields are a 400, not
 * silently dropped), strings carry a maxLength, enums come from USER_ROLES, and
 * every RESPONSE object is closed (`additionalProperties: false`) so a new column
 * can never leak: the serialiser only emits fields named here. `passwordHash`
 * appears in no schema at all.
 */

export const Role = Type.Unsafe<(typeof USER_ROLES)[number]>({
  type: 'string',
  enum: [...USER_ROLES],
})

/** A person's name: bounded, and no control characters or angle brackets. */
export const Name = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[^\\u0000-\\u001F<>]+$',
})

export const Phone = Type.String({ pattern: '^\\+?[0-9 ().-]{5,32}$', maxLength: 32 })

/** Profile ids are uuids for new rows but the seed data uses `user-admin-01`. */
export const IdParams = Strict({ id: EntityId })

// ── responses ───────────────────────────────────────────────────────────────

const AddressOut = Strict({
  addressLine1: Type.String(),
  city: Type.String(),
  state: Type.String(),
  postalCode: Type.String(),
  country: Type.String(),
  isDefaultShipping: Type.Boolean(),
})

export const UserOut = Strict({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  phoneNumber: Type.Union([Type.String(), Type.Null()]),
  role: Role,
  isActive: Type.Boolean(),
  isEmailVerified: Type.Boolean(),
  addresses: Type.Array(AddressOut),
  createdAt: Type.String(),
})

export const UserListOut = Strict({
  users: Type.Array(UserOut),
  total: Type.Integer(),
  page: Type.Integer(),
  limit: Type.Integer(),
})

export const SuccessOut = Strict({ success: Type.Boolean() })

// ── users ───────────────────────────────────────────────────────────────────

export const ListUsersQuery = Strict({
  page: Type.Integer({ minimum: 1, maximum: 100_000, default: 1 }),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 10 }),
})

export const AdminCreateUserBody = Strict({
  email: Email,
  firstName: Name,
  lastName: Name,
  role: Type.Optional(Role),
  isActive: Type.Optional(Type.Boolean()),
  /**
   * The admin vouches for the address, so the Supabase account is created
   * confirmed (the default). Pass false to leave it unconfirmed.
   */
  emailConfirm: Type.Optional(Type.Boolean()),
  addressLine1: Type.Optional(Str(200)),
  city: Type.Optional(Str(100)),
  state: Type.Optional(Str(100)),
  postalCode: Type.Optional(Str(20)),
  country: Type.Optional(Str(100)),
})

/**
 * Self-service profile update. Deliberately has NO role, isActive or
 * isEmailVerified: with `additionalProperties: false` sending one is a 400,
 * which is what closes the old "PATCH my own role to ADMIN" hole.
 */
export const UpdateProfileBody = Strict(
  {
    firstName: Type.Optional(Name),
    lastName: Type.Optional(Name),
    phoneNumber: Type.Optional(Phone),
  },
  { minProperties: 1 }
)

export const UpdateRoleBody = Strict({ role: Role })
export const UpdateStatusBody = Strict({ isActive: Type.Boolean() })

// ── auth ────────────────────────────────────────────────────────────────────

export const RegisterBody = Strict({
  email: Email,
  password: Password,
  firstName: Name,
  lastName: Name,
})

/** Sign-in accepts any non-empty password: the length rule applies at sign-UP only. */
export const LoginBody = Strict({ email: Email, password: Str(128) })

export const RefreshBody = Strict({ refresh_token: Str(1024) })

export const RegisterOut = Strict({ message: Type.String() })

export const SessionOut = Strict({
  access_token: Type.String(),
  refresh_token: Type.String(),
  expires_in: Type.Integer(),
  user: Strict({ id: Type.String(), email: Type.String(), role: Role }),
})
