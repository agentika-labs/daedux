import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { BrowserWindow } from "electrobun/bun";

import { log } from "../utils/log";

// macOS native window effect constants
const MAC_TRAFFIC_LIGHTS_X = 14;
const MAC_TRAFFIC_LIGHTS_Y = 22; // Vertically centered with header content

// Header height for native drag region (matches py-3 padding + content)
const MAC_HEADER_HEIGHT = 60;

/** The FFI symbol signature for the native effects library. */
const NATIVE_LIB_SYMBOLS = {
  enableWindowVibrancy: {
    args: [FFIType.ptr],
    returns: FFIType.bool,
  },
  ensureWindowShadow: {
    args: [FFIType.ptr],
    returns: FFIType.bool,
  },
  extendTitlebarWithToolbar: {
    args: [FFIType.ptr],
    returns: FFIType.bool,
  },
  setDragExclusionZones: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.bool,
  },
  setNativeWindowDragRegion: {
    args: [FFIType.ptr, FFIType.f64, FFIType.f64],
    returns: FFIType.bool,
  },
  setWindowTrafficLightsPosition: {
    args: [FFIType.ptr, FFIType.f64, FFIType.f64],
    returns: FFIType.bool,
  },
} as const;

/** Type of the loaded native library handle. */
export type NativeLib = ReturnType<typeof dlopen<typeof NATIVE_LIB_SYMBOLS>>;

/**
 * Load the native macOS window effects dylib.
 * Returns null if the dylib is not found (e.g., non-macOS or dev builds without the binary).
 */
export const loadNativeLib = (
  basePath: string
): NativeLib | null => {
  const dylibPath = join(basePath, "libMacWindowEffects.dylib");

  if (!existsSync(dylibPath)) {
    log.warn(
      "macos",
      `Native effects lib not found at ${dylibPath}. Falling back to transparent-only mode.`
    );
    return null;
  }

  return dlopen(dylibPath, NATIVE_LIB_SYMBOLS);
};

/**
 * Update drag exclusion zones — areas where clicks pass through to the WebView.
 * Called from renderer when button positions change.
 */
export const updateDragExclusionZones = (
  zones: { x: number; y: number; width: number; height: number }[],
  windowPtr: Pointer,
  nativeLib: NativeLib
): boolean => {
  // Flatten zones to contiguous Float64Array: [x1, y1, w1, h1, x2, y2, w2, h2, ...]
  const flatArray = new Float64Array(zones.length * 4);
  zones.forEach((zone, i) => {
    flatArray[i * 4] = zone.x;
    flatArray[i * 4 + 1] = zone.y;
    flatArray[i * 4 + 2] = zone.width;
    flatArray[i * 4 + 3] = zone.height;
  });

  return nativeLib.symbols.setDragExclusionZones(
    windowPtr,
    flatArray,
    zones.length
  );
};

/**
 * Apply native macOS vibrancy, traffic light positioning, and drag region.
 * Uses FFI to call into libMacWindowEffects.dylib.
 *
 * The native drag view captures mouse events for window dragging, but uses
 * exclusion zones to pass clicks through to buttons in the header.
 *
 * @returns The loaded NativeLib handle (for later use with updateDragExclusionZones), or null on failure.
 */
export const applyMacOSWindowEffects = (
  window: BrowserWindow,
  basePath: string,
  onResize: (isFullscreen: boolean) => void
): NativeLib | null => {
  const lib = loadNativeLib(basePath);
  if (!lib) {
    return null;
  }

  try {
    const vibrancyEnabled = lib.symbols.enableWindowVibrancy(window.ptr);
    const shadowEnabled = lib.symbols.ensureWindowShadow(window.ptr);
    const toolbarExtended = lib.symbols.extendTitlebarWithToolbar(window.ptr);

    const alignButtons = () =>
      lib.symbols.setWindowTrafficLightsPosition(
        window.ptr,
        MAC_TRAFFIC_LIGHTS_X,
        MAC_TRAFFIC_LIGHTS_Y
      );

    const buttonsAlignedNow = alignButtons();

    // Set up native drag region for header area
    // X offset accounts for traffic lights area
    const dragRegionEnabled = lib.symbols.setNativeWindowDragRegion(
      window.ptr,
      0, // Start from left edge - exclusion zones handle traffic lights
      MAC_HEADER_HEIGHT
    );

    // Re-align after brief delay (window may still be setting up)
    setTimeout(() => {
      alignButtons();
    }, 120);

    // Re-align on resize and detect fullscreen transitions
    let wasFullscreen = false;
    window.on("resize", () => {
      alignButtons();
      const isFs = window.isFullScreen();
      if (isFs !== wasFullscreen) {
        wasFullscreen = isFs;
        onResize(isFs);
      }
    });

    log.info(
      "macos",
      `Native effects applied (vibrancy=${vibrancyEnabled}, shadow=${shadowEnabled}, toolbar=${toolbarExtended}, trafficLights=${buttonsAlignedNow}, dragRegion=${dragRegionEnabled})`
    );

    return lib;
  } catch (error) {
    log.warn("macos", "Failed to apply native window effects:", error);
    return null;
  }
};
