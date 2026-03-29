import type { DateFilter } from "./rpc-types";

/**
 * Parse a filter string (from URL search params) into a DateFilter for analytics queries.
 * Shared by both Electrobun RPC and CLI HTTP server.
 */
export const parseDateFilter = (filter?: string | null): DateFilter => {
  const now = Date.now();

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { endTime: now, startTime: start.getTime() };
    }
    case "7d": {
      return { endTime: now, startTime: now - 7 * 86_400_000 };
    }
    case "30d": {
      return { endTime: now, startTime: now - 30 * 86_400_000 };
    }
    case "all": {
      // Explicit full range: epoch to now
      // This ensures buildComparisonWindows detects hasFilter=true
      // and uses our bounds instead of defaulting to 7 days
      return { startTime: 0, endTime: now };
    }
    default: {
      // No filter specified (undefined/null) - returns empty
      return {};
    }
  }
};
