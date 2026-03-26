import { describe, expect, test } from "bun:test";

import { Schema } from "effect";

import {
  OtlpMetricsRequest,
  OtlpLogsRequest,
  getStringAttr,
  getNumberAttr,
  getBoolAttr,
  parseNanoTimestamp,
} from "../../src/bun/otel/types";

describe("OTEL Types", () => {
  describe("parseNanoTimestamp", () => {
    test("converts nanoseconds to milliseconds", () => {
      // 1709000000000000000 ns = 1709000000000 ms
      const result = parseNanoTimestamp("1709000000000000000");
      expect(result).toBe(1_709_000_000_000);
    });

    test("handles small values", () => {
      const result = parseNanoTimestamp("1000000");
      expect(result).toBe(1);
    });
  });

  describe("getStringAttr", () => {
    const attrs = [
      { key: "session.id", value: { stringValue: "abc123" } },
      { key: "model", value: { stringValue: "claude-3-opus" } },
    ];

    test("extracts string value", () => {
      expect(getStringAttr(attrs, "session.id")).toBe("abc123");
    });

    test("returns null for missing key", () => {
      expect(getStringAttr(attrs, "missing")).toBeNull();
    });
  });

  describe("getNumberAttr", () => {
    const attrs = [
      { key: "cost_usd", value: { doubleValue: 0.05 } },
      { key: "tokens", value: { intValue: "1500" } },
    ];

    test("extracts double value", () => {
      expect(getNumberAttr(attrs, "cost_usd")).toBe(0.05);
    });

    test("extracts int value as number", () => {
      expect(getNumberAttr(attrs, "tokens")).toBe(1500);
    });

    test("returns null for missing key", () => {
      expect(getNumberAttr(attrs, "missing")).toBeNull();
    });
  });

  describe("getBoolAttr", () => {
    const attrs = [{ key: "success", value: { boolValue: true } }];

    test("extracts boolean value", () => {
      expect(getBoolAttr(attrs, "success")).toBe(true);
    });

    test("returns null for missing key", () => {
      expect(getBoolAttr(attrs, "missing")).toBeNull();
    });
  });

  describe("OtlpMetricsRequest schema", () => {
    test("validates minimal payload", () => {
      const payload = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "claude_code.token.usage",
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: "1709000000000000000",
                          asDouble: 1500,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = Schema.decodeUnknownSync(OtlpMetricsRequest)(payload);
      expect(result.resourceMetrics).toHaveLength(1);
    });

    test("rejects invalid payload", () => {
      const invalid = { resourceMetrics: "not-an-array" };
      expect(() =>
        Schema.decodeUnknownSync(OtlpMetricsRequest)(invalid)
      ).toThrow();
    });
  });

  describe("OtlpLogsRequest schema", () => {
    test("validates minimal payload", () => {
      const payload = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1709000000000000000",
                    body: { stringValue: "claude_code.api_request" },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = Schema.decodeUnknownSync(OtlpLogsRequest)(payload);
      expect(result.resourceLogs).toHaveLength(1);
    });

    test("rejects invalid payload", () => {
      const invalid = { resourceLogs: null };
      expect(() =>
        Schema.decodeUnknownSync(OtlpLogsRequest)(invalid)
      ).toThrow();
    });
  });
});
