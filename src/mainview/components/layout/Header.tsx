/**
 * Header with 3-tab navigation and filter controls.
 *
 * Uses TanStack Router Links for tab navigation, preserving search params
 * across tab switches. The filter controls update URL search params directly.
 */
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouter, useMatches } from "@tanstack/react-router";
import type { FC, SVGProps } from "react";
import { useEffect, useRef, useCallback, useMemo } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { rpcRequest } from "@/hooks/useRPC";
import { cn } from "@/lib/utils";
import type { HarnessFilterOption, FilterOption } from "@/queries/dashboard";

// ─── Inline SVG Logos ────────────────────────────────────────────────────────

const ClaudeLogo: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      fill="#D97757"
    />
  </svg>
);

const CodexLogo: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z"
      fill="#fff"
    />
    <path
      d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
      fill="url(#codex-gradient)"
    />
    <defs>
      <linearGradient
        gradientUnits="userSpaceOnUse"
        id="codex-gradient"
        x1="12"
        x2="12"
        y1="3"
        y2="21"
      >
        <stop stopColor="#B1A7FF" />
        <stop offset=".5" stopColor="#7A9DFF" />
        <stop offset="1" stopColor="#3941FF" />
      </linearGradient>
    </defs>
  </svg>
);

const OpenCodeLogo: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
  </svg>
);

// ─── Constants ───────────────────────────────────────────────────────────────

// Detect macOS for traffic light padding
const isMacOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

type LogoComponent = FC<SVGProps<SVGSVGElement>>;

const HARNESS_OPTIONS: {
  value: HarnessFilterOption;
  Logo: LogoComponent;
  tooltip: string;
}[] = [
  { value: "claude-code", Logo: ClaudeLogo, tooltip: "Claude Code" },
  { value: "opencode", Logo: OpenCodeLogo, tooltip: "OpenCode" },
  { value: "codex", Logo: CodexLogo, tooltip: "Codex" },
];

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { label: "Today", value: "today" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "All", value: "all" },
];

// Primary tabs with their routes
const PRIMARY_TABS = [
  { path: "/", label: "Overview" },
  { path: "/analytics", label: "Analytics" },
  { path: "/sessions", label: "Sessions" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function Header() {
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);
  const matches = useMatches();

  // Get current search params from any matched route that has them
  const currentSearch = useMemo(() => {
    // Find a match with search params (filter/harness)
    for (const match of matches) {
      const search = match.search as {
        filter?: FilterOption;
        harness?: HarnessFilterOption;
      };
      if (search?.filter || search?.harness) {
        return {
          filter: search.filter ?? "7d",
          harness: search.harness ?? "claude-code",
        };
      }
    }
    return {
      filter: "7d" as FilterOption,
      harness: "claude-code" as HarnessFilterOption,
    };
  }, [matches]);

  const { filter, harness } = currentSearch;

  // Determine active primary tab based on current path
  const activeTab = useMemo(() => {
    const pathname = router.state.location.pathname;
    if (pathname.startsWith("/analytics")) {
      return "/analytics";
    }
    if (pathname.startsWith("/sessions")) {
      return "/sessions";
    }
    if (pathname === "/settings") {
      return null;
    } // Settings is not a primary tab
    return "/";
  }, [router.state.location.pathname]);

  // Handle filter changes by navigating with new search params
  const handleFilterChange = useCallback(
    (newFilter: FilterOption) => {
      router.navigate({
        to: ".",
        search: (prev) => ({ ...prev, filter: newFilter }),
      });
    },
    [router]
  );

  const handleHarnessChange = useCallback(
    (newHarness: HarnessFilterOption) => {
      router.navigate({
        to: ".",
        search: (prev) => ({ ...prev, harness: newHarness }),
      });
    },
    [router]
  );

  // ─── macOS Drag Exclusion Zones ──────────────────────────────────────────────

  const updateExclusionZones = useCallback(() => {
    if (!headerRef.current || !isMacOS) {
      return;
    }

    const buttons = headerRef.current.querySelectorAll(
      'button, [role="button"], a'
    );
    const zones = [...buttons].map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    });

    rpcRequest("updateDragExclusionZones", { zones }).catch(() => {
      // Silently ignore - drag region is nice-to-have
    });
  }, []);

  useEffect(() => {
    if (!isMacOS) {
      return;
    }

    const initialTimeout = setTimeout(updateExclusionZones, 100);
    window.addEventListener("resize", updateExclusionZones);

    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener("resize", updateExclusionZones);
    };
  }, [updateExclusionZones]);

  // Update zones when filters change
  useEffect(() => {
    if (!isMacOS) {
      return;
    }
    const timeout = setTimeout(updateExclusionZones, 50);
    return () => clearTimeout(timeout);
  }, [filter, harness, updateExclusionZones]);

  return (
    <header
      ref={headerRef}
      className="bg-background desktop:bg-background/60 border-border sticky top-0 z-50 border-b desktop:backdrop-blur"
    >
      <div className={cn("px-6 py-3", isMacOS && "pl-24")}>
        <div className="flex items-center justify-between">
          {/* Title and Primary Tabs */}
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold">
              <span className="brand-gradient">Daedux</span>
            </h1>
            <Separator orientation="vertical" className="h-6" />
            <nav className="flex items-center gap-1">
              {PRIMARY_TABS.map(({ path, label }) => (
                <Link
                  key={path}
                  to={path}
                  search={{ filter, harness }}
                  activeOptions={{
                    exact: path === "/",
                    includeSearch: false,
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200",
                    activeTab === path
                      ? "bg-primary text-primary-foreground nav-pill-active"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Filter Controls */}
          <div className="flex items-center gap-3">
            {/* Harness Filter */}
            <div className="bg-muted flex items-center gap-1 rounded-lg p-1">
              {HARNESS_OPTIONS.map(({ value, Logo, tooltip }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => handleHarnessChange(value)}
                  title={tooltip}
                  className={cn(
                    "cursor-pointer rounded-md p-1.5 transition-colors",
                    harness === value
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Logo className="h-4 w-4" />
                </button>
              ))}
            </div>

            {/* Date Filter */}
            <div className="bg-muted flex items-center rounded-lg p-1">
              {FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => handleFilterChange(value)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors",
                    filter === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Settings */}
            <div className="bg-muted flex items-center rounded-lg p-1">
              <Link
                to="/settings"
                preload="intent"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  "rounded-md"
                )}
                aria-label="Open settings"
              >
                <HugeiconsIcon icon={Settings02Icon} className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
