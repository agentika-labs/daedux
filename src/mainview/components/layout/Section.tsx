import type { SectionId } from "@/hooks/useActiveSection";
import { cn } from "@/lib/utils";

interface SectionProps {
  id: SectionId;
  className?: string;
  children: React.ReactNode;
}

export function Section({ id, className, children }: SectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-6 first:pt-0", className)}>
      {children}
    </section>
  );
}
