-- Backend-owned credentials and email verification state.
ALTER TABLE "users"
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Single-use email tokens (address verification + password recovery).
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

CREATE INDEX "auth_tokens_userId_type_idx" ON "auth_tokens"("userId", "type");

CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens"("expiresAt");

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invitations become real tokenised records instead of snapshot rows.
ALTER TABLE "invitations"
ADD COLUMN "invitedByUserId" TEXT,
ADD COLUMN "fullName" TEXT,
ADD COLUMN "tokenHash" TEXT,
ADD COLUMN "acceptedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

CREATE INDEX "invitations_email_idx" ON "invitations"("email");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
