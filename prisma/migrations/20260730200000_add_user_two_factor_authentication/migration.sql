-- Invalidate stateless JWTs after password or MFA security changes.
ALTER TABLE "users"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

-- Authenticator-app credential. The API stores only an AES-256-GCM encrypted
-- TOTP seed; enrollment remains pending until enabledAt is set.
CREATE TABLE "user_two_factor_credentials" (
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabledAt" TIMESTAMP(3),
    "setupExpiresAt" TIMESTAMP(3),
    "lastUsedTimeStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_two_factor_credentials_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "two_factor_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeIndex" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "two_factor_login_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factor_recovery_codes_userId_codeIndex_key"
ON "two_factor_recovery_codes"("userId", "codeIndex");

CREATE UNIQUE INDEX "two_factor_recovery_codes_userId_codeHash_key"
ON "two_factor_recovery_codes"("userId", "codeHash");

CREATE INDEX "two_factor_recovery_codes_userId_usedAt_idx"
ON "two_factor_recovery_codes"("userId", "usedAt");

CREATE UNIQUE INDEX "two_factor_login_challenges_tokenHash_key"
ON "two_factor_login_challenges"("tokenHash");

CREATE INDEX "two_factor_login_challenges_userId_consumedAt_idx"
ON "two_factor_login_challenges"("userId", "consumedAt");

CREATE INDEX "two_factor_login_challenges_expiresAt_idx"
ON "two_factor_login_challenges"("expiresAt");

ALTER TABLE "user_two_factor_credentials"
ADD CONSTRAINT "user_two_factor_credentials_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "two_factor_recovery_codes"
ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user_two_factor_credentials"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "two_factor_login_challenges"
ADD CONSTRAINT "two_factor_login_challenges_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
