# Security

Validation, rate limiting, Supabase authentication and RBAC. Design and results live in the notes repo, `change-05-api-defense/`. [← Back to the README](../README.md)

## Security

Four layers, implemented in `@ecommerce/shared-security` and wired into the gateway and every service
(design and results: `change-05-api-defense/` in the notes repo).

1. **Input validation.** Strict Ajv (no body coercion), closed TypeBox request and response schemas, 100 KB JSON cap,
   non-JSON content types refused (415), upload magic-byte checks, Kafka payload schemas validated by consumers
   (bad events are recorded as rejected, never retried). Errors always look like
   `{statusCode, error, code, message, requestId, fields?}`.
2. **Rate limiting.** Redis fixed-window counters with tiers (read / write / auth / expensive / admin), keyed by IP, user
   and, for sign-in, email. Reads fail open; auth and admin fail closed. Responses carry `x-ratelimit-limit`,
   `-remaining`, `-reset` (Unix seconds) and `retry-after`. Falls back to memory when Redis is not the KV driver.
3. **Authentication (Supabase Auth).** Users sign in with Supabase; services verify the ES256 access token offline
   against the project's JWKS (issuer, audience, expiry). Service-to-service calls use a 60 s HS256 token signed with
   `SERVICE_AUTH_SECRET`. The business role comes only from the custom `app_role` claim, set by the **Custom Access
   Token Hook** (`packages/ms-user/supabase/001_custom_access_token_hook.sql`, run once in the Supabase SQL editor,
   then enable it under Authentication > Hooks). A token without the claim is treated as CUSTOMER. Admins need TOTP (`aal2`).
4. **Authorization (RBAC).** Every route declares a `config.policy` (default deny; `assertPolicyCoverage` fails boot and
   tests if one is missing). Roles ADMIN / VENDOR / CUSTOMER hold `resource:action[:any]` permissions; ownership
   mismatches answer 404; operator routes need `aal2`. VENDOR storage access is limited to `products/`.

Other measures: pino redaction of secrets, internal service ports published on `127.0.0.1` only, correlation ids on
every request and Kafka event (`x-correlation-id` / `traceparent`). `/metrics` is public, so rely on network isolation.

### Rollout switches

`AUTH_ENFORCE` and `RATE_LIMIT_ENFORCE` default to **`report`**: denials are logged (`access.denied`) but not blocked.
Flip to `enforce` only after the frontend follow-ups and a browser click-through on a side port; roll back by setting
the variable back to `report`. `PRICE_CHECK` (ms-order verifies prices with ms-product) defaults to `report` too.
See `.env.example` for the full list (`SUPABASE_*`, `CORS_ORIGINS`, `TRUST_PROXY`, `RATE_LIMIT_*_PER_MIN` overrides; defaults live in `packages/shared/constants/src/rateLimit.ts`).

```bash
pnpm --filter @ecommerce/ms-user run auth:sync             # dry run: lists seeded profiles without a Supabase account
pnpm --filter @ecommerce/ms-user run auth:sync -- --apply  # create the accounts (writes to the live project)
```
