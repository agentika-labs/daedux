import { useState, useEffect, useRef } from "react";

export type SectionId =
  | "overview"
  | "cost"
  | "efficiency"
  | "tools"
  | "automation"
  | "sessions"
  | "projects";

export interface Section {
  id: SectionId;
  label: string;
}

export const SECTIONS: Section[] = [
  { id: "overview", label: "Overview" },
  { id: "cost", label: "Cost" },
  { id: "efficiency", label: "Efficiency" },
  { id: "tools", label: "Tools" },
  { id: "automation", label: "Automation" },
  { id: "projects", label: "Projects" },
  { id: "sessions", label: "Sessions" },
];

/**
 * Hook that tracks which section is currently visible in the viewport
 * using IntersectionObserver. Returns the active section ID for highlighting
 * the current nav item.
 */
export function useActiveSection(): SectionId {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    // Track visibility ratios for each section
    const visibilityMap = new Map<string, number>();

    // The scrollable container is <main>, not the window
    const mainElement = document.querySelector("main");

    observer.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibilityMap.set(entry.target.id, entry.intersectionRatio);
        });

        // Find the section with highest visibility
        let maxRatio = 0;
        let mostVisible = "overview";

        visibilityMap.forEach((ratio, id) => {
          if (ratio > maxRatio) {
            maxRatio = ratio;
            mostVisible = id;
          }
        });

        if (maxRatio > 0) {
          setActiveSection(mostVisible as SectionId);
        }
      },
      {
        root: mainElement, // Use main as the scroll container
        rootMargin: "-80px 0px -60% 0px", // Account for sticky header
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    // Observe all section elements
    SECTIONS.forEach(({ id }) => {
      const element = document.querySelector(`#${id}`);
      if (element && observer.current) {
        observer.current.observe(element);
      }
    });

    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, []);

  return activeSection;
}

/**
 * Smooth scroll to a section with offset for sticky header.
 * Directly scrolls the <main> element rather than using scrollIntoView(),
 * which can scroll the document level and push the header out of view.
 */
export function scrollToSection(sectionId: SectionId) {
  const element = document.querySelector(`#${sectionId}`);
  const main = document.querySelector("main");
  if (element && main) {
    const mainRect = main.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    // Calculate target scroll position: current scroll + element offset from main top - header offset
    const targetScroll = main.scrollTop + (elementRect.top - mainRect.top) - 80;

    main.scrollTo({
      behavior: "smooth",
      top: Math.max(0, targetScroll),
    });
  }
}
