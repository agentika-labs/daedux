/**
 * Clear an interval if it's active, then reset the state.
 */
export const clearIntervalIfActive = (
  getInterval: () => ReturnType<typeof setInterval> | null,
  setIntervalId: (id: ReturnType<typeof setInterval> | null) => void
): void => {
  const id = getInterval();
  if (id) {
    clearInterval(id);
    setIntervalId(null);
  }
};
