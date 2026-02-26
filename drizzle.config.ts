import type { Config } from "drizzle-kit";

export default {
  schema: "./src/bun/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `${process.env.HOME}/.claude/daedux.db`,
  },
} satisfies Config;
