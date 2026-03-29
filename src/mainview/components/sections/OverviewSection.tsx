import type { DashboardData } from "@shared/rpc-types";

import { Section } from "@/components/layout/Section";
import { EfficiencyGauge } from "@/components/sections/EfficiencyGauge";
import { HeroStats } from "@/components/sections/HeroStats";
import { InsightsPanel } from "@/components/shared/InsightsPanel";

interface OverviewSectionProps {
  data: DashboardData | null;
  loading?: boolean;
  onNavigateToSection?: (section: string) => void;
}

export function OverviewSection({
  data,
  loading,
  onNavigateToSection,
}: OverviewSectionProps) {
  return (
    <Section id="overview">
      {/* Hero Stats Row */}
      <HeroStats
        totals={data?.totals}
        efficiencyScore={data?.efficiencyScore}
        weeklyComparison={data?.weeklyComparison}
        loading={loading}
      />

      {/* Efficiency Score + Insights Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Efficiency Gauge */}
        <EfficiencyGauge
          efficiencyScore={data?.efficiencyScore}
          loading={loading}
        />

        {/* Insights Panel */}
        <InsightsPanel
          insights={data?.insights ?? []}
          loading={loading}
          onNavigateToSection={onNavigateToSection}
          className="lg:col-span-2"
        />
      </div>
    </Section>
  );
}
