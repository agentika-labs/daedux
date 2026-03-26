/**
 * Analytics index route - redirects to /analytics/cost
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/analytics/")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/analytics/cost",
      search,
    });
  },
});
