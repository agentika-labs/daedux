import { UnixTimestampMs } from "./branded";
import type { DateFilter } from "./rpc-types";

/**
 * Parse a filter string (from URL search params) into a DateFilter for analytics queries.
 * Shared by both Electrobun RPC and CLI HTTP server.
 */
export const parseDateFilter = (filter?: string | null): DateFilter => {
  const now = UnixTimestampMs(Date.now());

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { endTime: now, startTime: UnixTimestampMs(start.getTime()) };
    }
    case "7d": {
      return { endTime: now, startTime: UnixTimestampMs(now - 7 * 86_400_000) };
    }
    case "30d": {
      return {
        endTime: now,
        startTime: UnixTimestampMs(now - 30 * 86_400_000),
      };
    }
    case "all": {
      return { startTime: UnixTimestampMs(0), endTime: now };
    }
    default: {
      return {};
    }
  }
};
