import { cn } from "@/lib/utils";

interface SectionProps {
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Section wrapper for dashboard content areas.
 * Provides consistent spacing and optional id for anchor links.
 */
export function Section({ id, className, children }: SectionProps) {
  return (
    <section id={id} className={cn("py-6 first:pt-0", className)}>
      {children}
    </section>
  );
}
