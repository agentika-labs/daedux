/**
 * TanStack Router type augmentation.
 *
 * Extends the router's Register interface to support custom staticData
 * properties on routes.
 */
import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** When false, the root layout hides the main header */
    showHeader?: boolean;
  }
}
