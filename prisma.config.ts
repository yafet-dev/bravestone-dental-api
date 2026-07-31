import { existsSync } from "node:fs";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

if (existsSync("backend.env")) {
  config({ path: "backend.env", quiet: true });
} else if (existsSync(".env.local")) {
  config({ path: ".env.local", override: true, quiet: true });
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Client generation does not need a live database URL, so fresh installs can
  // still generate types before deployment secrets are available. Migration and
  // introspection commands use DIRECT_URL first, matching the runtime fallback.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
