import { existsSync } from "node:fs";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

if (existsSync("backend.env")) {
  config({ path: "backend.env", quiet: true });
} else if (existsSync(".env.local")) {
  config({ path: ".env.local", override: true, quiet: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma 7 expects migration/introspection URLs in config rather than schema.
    url: env("DIRECT_URL"),
  },
});
