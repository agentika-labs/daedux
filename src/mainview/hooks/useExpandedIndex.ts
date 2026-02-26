import { useCallback, useState } from "react";

/**
 * Hook for managing expanded/collapsed state in lists where only one item
 * can be expanded at a time.
 */
export function useExpandedIndex(initialIndex: number | null = null) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(initialIndex);

  const isExpanded = useCallback(
    (index: number) => expandedIndex === index,
    [expandedIndex]
  );

  const toggle = useCallback(
    (index: number) =>
      setExpandedIndex((current) => (current === index ? null : index)),
    []
  );

  return { expandedIndex, isExpanded, toggle };
}
