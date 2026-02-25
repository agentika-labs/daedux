import type { Config } from "drizzle-kit";

export default {
  schema: "./src/bun/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `${process.env.HOME}/.claude/usage-monitor.db`,
  },
} satisfies Config;
