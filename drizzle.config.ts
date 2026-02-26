import type { Config } from "drizzle-kit";

export default {
  dbCredentials: {
    url: `${process.env.HOME}/.claude/daedux.db`,
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/bun/db/schema.ts",
} satisfies Config;
