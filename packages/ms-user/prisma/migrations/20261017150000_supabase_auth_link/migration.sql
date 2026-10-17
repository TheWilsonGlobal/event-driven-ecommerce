-- Supabase Auth takes over credentials (change-05). Additive only: nothing is dropped.

-- password_hash is no longer written, so it must accept NULL.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Link to auth.users.id (the JWT sub). UUID so the access-token hook can compare it directly.
ALTER TABLE "users" ADD COLUMN "auth_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "target_user_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_target_user_id_idx" ON "audit_log"("target_user_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- Same defence in depth as the baseline: RLS on with no policies.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
