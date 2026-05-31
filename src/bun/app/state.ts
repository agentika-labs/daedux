import type { BrowserWindow, Tray } from "electrobun/bun";

import type { AppSettings } from "../../shared/rpc-types";
import type { NativeLib } from "../native/macos-effects";
import { loadSettings } from "../services/settings";

// ─── Platform Detection ─────────────────────────────────────────────────────

export const isMac = process.platform === "darwin";

// ─── Mutable State ──────────────────────────────────────────────────────────

let isScanning = false;
let isQuitting = false;
let lastScanAt: string | null = null;
let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isMainViewReady = false;
const pendingWebviewMessages: (() => void)[] = [];

// Native library reference for drag exclusion zones
let nativeLib: NativeLib | null = null;

// Update state
let updateAvailable = false;
let updateVersion: string | null = null;

// App settings (persisted via settings file)
let settings: AppSettings = loadSettings();

// ─── Getters ────────────────────────────────────────────────────────────────

export const getIsScanning = () => isScanning;
export const getIsQuitting = () => isQuitting;
export const getLastScanAt = () => lastScanAt;
export const getScanIntervalId = () => scanIntervalId;
export const getSchedulerIntervalId = () => schedulerIntervalId;
export const getMainWindow = (): BrowserWindow | null => mainWindow;
export const getTray = (): Tray | null => tray;
export const getIsMainViewReady = () => isMainViewReady;
export const getPendingWebviewMessages = () => pendingWebviewMessages;
export const getNativeLib = () => nativeLib;
export const getUpdateAvailable = () => updateAvailable;
export const getUpdateVersion = () => updateVersion;
export const getSettings = () => settings;

// ─── Setters ────────────────────────────────────────────────────────────────

export const setIsScanning = (value: boolean) => {
  isScanning = value;
};
export const setIsQuitting = (value: boolean) => {
  isQuitting = value;
};
export const setLastScanAt = (value: string | null) => {
  lastScanAt = value;
};
export const setScanIntervalId = (
  value: ReturnType<typeof setInterval> | null
) => {
  scanIntervalId = value;
};
export const setSchedulerIntervalId = (
  value: ReturnType<typeof setInterval> | null
) => {
  schedulerIntervalId = value;
};
export const setMainWindow = (value: BrowserWindow | null) => {
  mainWindow = value;
};
export const setTray = (value: Tray | null) => {
  tray = value;
};
export const setIsMainViewReady = (value: boolean) => {
  isMainViewReady = value;
};
export const setNativeLib = (value: NativeLib | null) => {
  nativeLib = value;
};
export const setUpdateAvailable = (value: boolean) => {
  updateAvailable = value;
};
export const setUpdateVersion = (value: string | null) => {
  updateVersion = value;
};
export const setSettings = (value: AppSettings) => {
  settings = value;
};
export const updateSettings = (patch: Partial<AppSettings>) => {
  settings = { ...settings, ...patch };
};

// ─── Helper for clearing pending messages ───────────────────────────────────

export const clearPendingWebviewMessages = () => {
  pendingWebviewMessages.length = 0;
};
