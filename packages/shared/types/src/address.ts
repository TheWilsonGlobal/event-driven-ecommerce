/**
 * A full postal address as stored against a user account.
 *
 * `addressLine2` and the `isDefault*` flags only make sense in that context —
 * a shipping address snapshotted onto an order has neither. Narrower call
 * sites should `Pick`/`Omit` from this rather than redeclaring the field set
 * (see `OrderAddress` below).
 */
export interface Address {
  addressLine1: string
  addressLine2?: string | null
  city: string
  state: string
  postalCode: string
  country: string
  isDefaultShipping?: boolean
  isDefaultBilling?: boolean
}

/**
 * The address shape snapshotted onto an order at checkout time (shipping or
 * billing). Deliberately excludes the account-level `isDefault*` flags, which
 * don't apply to a point-in-time snapshot.
 */
export type OrderAddress = Pick<
  Address,
  'addressLine1' | 'city' | 'state' | 'postalCode' | 'country'
>
