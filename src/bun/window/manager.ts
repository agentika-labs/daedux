import { BrowserWindow, Utils } from "electrobun/bun";

import {
  clearPendingWebviewMessages,
  getIsQuitting,
  getMainWindow,
  isMac,
  setIsMainViewReady,
  setMainWindow,
  setNativeLib,
} from "../app/state";
import { applyMacOSWindowEffects } from "../native/macos-effects";
import { log } from "../utils/log";
import { flushPendingWebviewMessages } from "./messaging";

// ─── Types ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRPC = any;

export interface WindowManagerDeps {
  rpc: AnyRPC;
  onWindowClose?: () => void;
  onFullscreenChanged?: (isFullscreen: boolean) => void;
}

// ─── Window Creation ────────────────────────────────────────────────────────

/**
 * Create the main application window.
 */
export const createMainWindow = (deps: WindowManagerDeps): BrowserWindow => {
  const devUrl =
    process.env.ELECTROBUN_RENDERER_URL ??
    process.env.VITE_DEV_SERVER_URL ??
    null;
  const url =
    devUrl && devUrl.trim().length > 0 ? devUrl : "views://mainview/index.html";

  setIsMainViewReady(false);

  const window = new BrowserWindow({
    title: "Daedux",
    frame: {
      height: 860,
      width: 1320,
      x: 64,
      y: 64,
    },
    url,
    renderer: "native",
    rpc: deps.rpc,
    // macOS: Use hidden inset title bar with native traffic lights, and enable transparency for vibrancy
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          transparent: true,
        }
      : {
          titleBarStyle: "default" as const,
        }),
  });

  // Apply native macOS vibrancy effects
  if (isMac) {
    const nativeLib = applyMacOSWindowEffects(
      window,
      import.meta.dir,
      deps.onFullscreenChanged ?? (() => {})
    );
    setNativeLib(nativeLib);
  }

  const webviewWithEvents = window.webview as unknown as {
    on?: (event: string, handler: () => void) => void;
  };

  if (typeof webviewWithEvents.on === "function") {
    webviewWithEvents.on("dom-ready", () => {
      if (getMainWindow() !== window) {
        return;
      }
      setIsMainViewReady(true);
      flushPendingWebviewMessages();
    });
  } else {
    queueMicrotask(() => {
      if (getMainWindow() !== window) {
        return;
      }
      setIsMainViewReady(true);
      flushPendingWebviewMessages();
    });
  }

  // Fallback: if dom-ready is lost (e.g. FFI bridge garbles the event during
  // a message burst), flush pending messages after a timeout so the app still loads.
  setTimeout(() => {
    if (getMainWindow() === window) {
      const isReady = getMainWindow() !== null;
      if (!isReady) {
        log.warn(
          "webview",
          "dom-ready not received within 5s, flushing pending messages"
        );
        setIsMainViewReady(true);
        flushPendingWebviewMessages();
      }
    }
  }, 5000);

  window.on("close", () => {
    if (getMainWindow() === window) {
      setMainWindow(null);
      setIsMainViewReady(false);
      clearPendingWebviewMessages();
    }

    if (!getIsQuitting()) {
      deps.onWindowClose?.();
    }
  });

  return window;
};

// ─── Window Helpers ─────────────────────────────────────────────────────────

/**
 * Ensure a main window exists, creating one if needed.
 */
export const ensureMainWindow = (
  deps: WindowManagerDeps
): { created: boolean; window: BrowserWindow } => {
  const existing = getMainWindow();
  if (existing) {
    return { created: false, window: existing };
  }

  const window = createMainWindow(deps);
  setMainWindow(window);
  return { created: true, window };
};

/**
 * Show and focus the main window, creating it if needed.
 */
export const showMainWindow = (deps: WindowManagerDeps): void => {
  const { window } = ensureMainWindow(deps);

  if (window.isMinimized()) {
    window.unminimize();
  }

  window.show();
  window.focus();
};

/**
 * Quit the application.
 */
export const quitApp = (): void => {
  Utils.quit();
};
