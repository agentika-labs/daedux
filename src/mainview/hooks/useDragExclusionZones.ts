import type { RefObject } from "react";
import { useCallback, useEffect } from "react";

import { useIsDesktop } from "@/hooks/useApi";
import { rpcRequest } from "@/hooks/useRPC";

const isMacOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

/**
 * Manages macOS native drag exclusion zones for a container element.
 *
 * Calculates button/link bounding rects within the container and sends them
 * to the main process so they're excluded from the window drag region.
 * Updates on mount, window resize, and whenever extraDeps change.
 */
export function useDragExclusionZones(
  containerRef: RefObject<HTMLElement | null>,
  extraDeps: unknown[] = []
): void {
  const isDesktop = useIsDesktop();

  const updateZones = useCallback(() => {
    if (!containerRef.current || !isMacOS) {
      return;
    }

    const buttons = containerRef.current.querySelectorAll(
      'button, [role="button"], a'
    );
    const zones = [...buttons].map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    });

    rpcRequest("updateDragExclusionZones", { zones }).catch(() => {
      // Silently ignore - drag region is nice-to-have
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  // Mount + resize listener
  useEffect(() => {
    if (!isMacOS || !isDesktop) {
      return;
    }

    const initialTimeout = setTimeout(updateZones, 100);
    window.addEventListener("resize", updateZones);

    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener("resize", updateZones);
    };
  }, [updateZones, isDesktop]);

  // Update when extra dependencies change (e.g., filter values, content changes)
  useEffect(() => {
    if (!isMacOS || !isDesktop) {
      return;
    }
    const timeout = setTimeout(updateZones, 50);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateZones, isDesktop, ...extraDeps]);
}
