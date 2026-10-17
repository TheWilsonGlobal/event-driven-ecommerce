-- Custom Access Token Hook: copies ms_user.users.role into the JWT as `app_role`.
--
-- Why: the standard `role` claim in a Supabase JWT is the POSTGRES role
-- ("authenticated"), not our business role. Every service reads the custom
-- `app_role` claim (ADMIN | VENDOR | CUSTOMER) instead, so ms_user.users.role
-- stays the single source of truth and an admin's role change reaches the next
-- token without anyone editing JWT settings.
--
-- Least privilege: a user with no profile row yet (signed up directly through
-- supabase-js before their first GET /api/v1/users/me) gets CUSTOMER, never an
-- elevated role, and so does any value that is not one of the three known roles.
--
-- ── How to enable (Supabase dashboard, NOT done by this repo) ──────────────────
--   1. Apply the ms-user Prisma migration first (it adds ms_user.users.auth_user_id).
--   2. Run this file once in the SQL editor of the project.
--   3. Dashboard > Authentication > Hooks > "Customize Access Token (JWT) Claims"
--      > select schema `public`, function `custom_access_token_hook` > Save.
--   4. Sign in with a test user and decode the access token: it must carry
--      `app_role`. Tokens issued BEFORE the hook was enabled keep working but have
--      no `app_role`, so the API treats them as least privilege until they refresh.
--
-- Nothing here runs automatically and nothing here is executed by the test suite.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
-- SECURITY DEFINER: ms_user.users has row level security enabled with no
-- policies (the publishable key must read nothing), so the function must run as
-- its owner to see the row. The search_path is pinned to empty, which forces
-- every object below to be schema-qualified and removes the search_path
-- hijacking risk that makes unpinned definer functions dangerous.
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  user_role text;
begin
  select u.role
    into user_role
    from ms_user.users u
   where u.auth_user_id = (event ->> 'user_id')::uuid
   limit 1;

  if user_role is null or user_role not in ('ADMIN', 'VENDOR', 'CUSTOMER') then
    user_role := 'CUSTOMER';
  end if;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{app_role}', to_jsonb(user_role));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Only Supabase Auth may run the hook. A function in `public` is reachable as an
-- RPC by anon / authenticated callers unless EXECUTE is revoked explicitly.
revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Belt and braces: the definer rights above are what actually read the table,
-- but these grants let the auth admin role use the schema if the function is
-- ever switched to SECURITY INVOKER (that would also need an RLS policy).
grant usage on schema ms_user to supabase_auth_admin;
grant select on table ms_user.users to supabase_auth_admin;
