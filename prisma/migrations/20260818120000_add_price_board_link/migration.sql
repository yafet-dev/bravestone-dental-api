-- Public waiting-room price board link.
--
-- `priceBoardSlug` is the readable clinic segment of the URL and is claimed once,
-- so a published link keeps working when the clinic renames itself. Only the code
-- is rotated or cleared, and clearing it turns the public board off without
-- releasing the slug to another clinic.
ALTER TABLE "organizations"
ADD COLUMN "priceBoardSlug" TEXT,
ADD COLUMN "priceBoardCode" TEXT;

CREATE UNIQUE INDEX "organizations_priceBoardSlug_key"
ON "organizations"("priceBoardSlug");
