import { useCallback, useState } from "react";

/**
 * Hook for copying text to clipboard with auto-reset feedback.
 * Returns { copied, copy } - state and copy function.
 */
export function useCopyToClipboard(duration = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), duration);
    },
    [duration]
  );

  return { copied, copy };
}
