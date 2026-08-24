CREATE TABLE "signup_otp_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signup_otp_challenges_userId_createdAt_idx"
ON "signup_otp_challenges"("userId", "createdAt");

CREATE INDEX "signup_otp_challenges_expiresAt_idx"
ON "signup_otp_challenges"("expiresAt");

ALTER TABLE "signup_otp_challenges"
ADD CONSTRAINT "signup_otp_challenges_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
