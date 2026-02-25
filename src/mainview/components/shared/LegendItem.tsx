interface LegendItemProps {
  color: string;
  label: string;
  value: string;
}

/**
 * A legend item for charts showing a color swatch, label, and value.
 * Used in horizontal legends below chart visualizations.
 */
export function LegendItem({ color, label, value }: LegendItemProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
