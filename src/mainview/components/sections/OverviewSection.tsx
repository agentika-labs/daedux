import type { DashboardData } from "@shared/rpc-types";

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
    <div className="flex flex-col">
      {/* Hero Stats Row — sealed metric cells */}
      <HeroStats
        totals={data?.totals}
        efficiencyScore={data?.efficiencyScore}
        weeklyComparison={data?.weeklyComparison}
        loading={loading}
      />

      {/* Efficiency Score + Insights Row — sealed grid */}
      <div className="border-border grid grid-cols-1 border-b lg:grid-cols-3">
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
          className="border-border lg:col-span-2 lg:border-l"
        />
      </div>
    </div>
  );
}
