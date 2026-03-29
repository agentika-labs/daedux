import { useEffect, useRef } from "react";

import { useIsDesktop } from "@/hooks/useApi";

/**
 * Listen for desktop RPC "sessionsUpdated" messages and call the provided refetch function.
 * Dynamically imports the Electrobun RPC bridge only in desktop mode.
 * Handles listener cleanup on unmount.
 */
export const useDesktopRefetch = (refetch: () => void) => {
  const isDesktop = useIsDesktop();
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cleanup: (() => void) | undefined;

    import("@/hooks/useRPC").then(({ electroview }) => {
      const handleUpdate = () => refetchRef.current();
      electroview.addMessageListener("sessionsUpdated", handleUpdate);
      cleanup = () =>
        electroview.removeMessageListener("sessionsUpdated", handleUpdate);
    });

    return () => cleanup?.();
  }, [isDesktop]);
};
