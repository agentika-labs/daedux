import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Effect, Schema } from "effect";

import type { AppSettings } from "../../shared/rpc-types";
import { log } from "../utils/log";

// Platform-specific settings path (matches db location pattern)
const getSettingsPath = (): string => {
  const platform = process.platform;
  if (platform === "darwin") {
    return join(homedir(), "Library/Application Support/Daedux/settings.json");
  } else if (platform === "win32") {
    return join(process.env.APPDATA ?? homedir(), "Daedux/settings.json");
  }
  return join(homedir(), ".local/share/daedux/settings.json");
};

const SETTINGS_PATH = getSettingsPath();

// Schema for runtime validation
const PersistedSettingsSchema = Schema.Struct({
  theme: Schema.optional(Schema.Literal("system", "light", "dark")),
  scanOnLaunch: Schema.optional(Schema.Boolean),
  scanIntervalMinutes: Schema.optional(Schema.Number),
  customPaths: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  schedulerEnabled: Schema.optional(Schema.Boolean),
  otel: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      retentionDays: Schema.Number,
      roiHourlyDevCost: Schema.Number,
      roiMinutesPerLoc: Schema.Number,
      roiMinutesPerCommit: Schema.Number,
    })
  ),
  usageMethod: Schema.optional(
    Schema.Struct({
      method: Schema.Literal("oauth", "cli", "unknown"),
      determinedAt: Schema.NullOr(Schema.Number),
    })
  ),
});

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  scanOnLaunch: true,
  scanIntervalMinutes: 5,
  customPaths: {},
  schedulerEnabled: false,
  otel: {
    enabled: true,
    retentionDays: 30,
    roiHourlyDevCost: 50,
    roiMinutesPerLoc: 3,
    roiMinutesPerCommit: 15,
  },
};

/**
 * Load settings from disk (sync, for startup).
 * Returns defaults if file missing or corrupted.
 */
export const loadSettings = (): AppSettings => {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      return DEFAULT_SETTINGS;
    }
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Validate with schema - catches type mismatches
    const result = Schema.decodeUnknownSync(PersistedSettingsSchema)(parsed);
    return { ...DEFAULT_SETTINGS, ...result };
  } catch (error) {
    log.warn("settings", "Failed to load settings, using defaults", error);
    return DEFAULT_SETTINGS;
  }
};

/**
 * Save settings to disk atomically (write temp + rename).
 * Prevents corruption from partial writes or crashes.
 */
export const saveSettings = (settings: AppSettings): void => {
  try {
    const dir = dirname(SETTINGS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tempPath = `${SETTINGS_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(settings, null, 2));
    renameSync(tempPath, SETTINGS_PATH);
  } catch (error) {
    log.warn("settings", "Failed to save settings", error);
  }
};

/**
 * Effect-wrapped save for use in Effect services.
 */
export const saveSettingsEffect = (settings: AppSettings) =>
  Effect.sync(() => {
    saveSettings(settings);
  });

/**
 * Atomic update: read current, apply patch, save.
 * For use from anthropic-usage.ts to persist method preference.
 */
export const updateSettingsEffect = (patch: Partial<AppSettings>) =>
  Effect.sync(() => {
    const current = loadSettings();
    const updated = { ...current, ...patch };
    saveSettings(updated);
    return updated;
  });
