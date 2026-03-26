import type { SessionSchedule } from "@shared/rpc-types";
import { useState, useId } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ScheduleFormProps {
  schedule?: SessionSchedule | null;
  onSave: (input: {
    name: string;
    hour: number;
    minute: number;
    daysOfWeek: number[];
    enabled?: boolean;
  }) => void;
  onCancel: () => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];
const DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const formatHour = (hour: number): string => {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h} ${ampm}`;
};

export const ScheduleForm = ({
  schedule,
  onSave,
  onCancel,
}: ScheduleFormProps) => {
  const [form, setForm] = useState({
    name: schedule?.name ?? "",
    hour: schedule?.hour ?? 15,
    minute: schedule?.minute ?? 0,
    daysOfWeek: schedule?.daysOfWeek ?? [1, 2, 3, 4, 5], // Default to weekdays
  });
  const [error, setError] = useState<string | null>(null);

  const nameId = useId();
  const timeId = useId();
  const daysId = useId();

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].toSorted(),
    }));
  };

  const handleSubmit = () => {
    // Validation
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (form.daysOfWeek.length === 0) {
      setError("Select at least one day");
      return;
    }

    onSave({
      daysOfWeek: form.daysOfWeek,
      enabled: schedule?.enabled ?? true,
      hour: form.hour,
      minute: form.minute,
      name: form.name.trim(),
    });
  };

  const handleSelectPreset = (preset: "weekdays" | "weekends" | "everyday") => {
    switch (preset) {
      case "weekdays": {
        setForm((prev) => ({ ...prev, daysOfWeek: [1, 2, 3, 4, 5] }));
        break;
      }
      case "weekends": {
        setForm((prev) => ({ ...prev, daysOfWeek: [0, 6] }));
        break;
      }
      case "everyday": {
        setForm((prev) => ({ ...prev, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }));
        break;
      }
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {schedule ? "Edit Schedule" : "New Schedule"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Configure when this warm-up session should run.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Name Input */}
          <div className="space-y-2">
            <label htmlFor={nameId} className="text-sm font-medium">
              Name
            </label>
            <input
              id={nameId}
              type="text"
              value={form.name}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }));
                setError(null);
              }}
              placeholder="e.g., Before work"
              className="border-input bg-input/30 focus:border-ring focus:ring-ring/50 h-9 w-full rounded-xl border px-3 text-sm transition-colors outline-none focus:ring-2"
            />
          </div>

          {/* Time Selection - uses aria-labelledby for composite control (WAI-ARIA 1.2 pattern for groups of related inputs) */}
          <div className="space-y-2">
            <div id={timeId} className="text-sm font-medium">
              Time
            </div>
            <div className="flex items-center gap-2" aria-labelledby={timeId}>
              <Select
                value={form.hour.toString()}
                onValueChange={(v) =>
                  v &&
                  setForm((prev) => ({
                    ...prev,
                    hour: Number.parseInt(v, 10),
                  }))
                }
              >
                <SelectTrigger className="w-24" aria-labelledby={timeId}>
                  <SelectValue>{formatHour(form.hour)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={h.toString()}>
                      {formatHour(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">:</span>
              <Select
                value={form.minute.toString()}
                onValueChange={(v) =>
                  v &&
                  setForm((prev) => ({
                    ...prev,
                    minute: Number.parseInt(v, 10),
                  }))
                }
              >
                <SelectTrigger className="w-20" aria-labelledby={timeId}>
                  <SelectValue>
                    {form.minute.toString().padStart(2, "0")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((m) => (
                    <SelectItem key={m} value={m.toString()}>
                      {m.toString().padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Day Selection - uses role="group" with aria-labelledby (WAI-ARIA 1.2 pattern for toggle button groups) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div id={daysId} className="text-sm font-medium">
                Days
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleSelectPreset("weekdays")}
                >
                  Weekdays
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleSelectPreset("weekends")}
                >
                  Weekends
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleSelectPreset("everyday")}
                >
                  All
                </Button>
              </div>
            </div>
            <div className="flex gap-1.5" role="group" aria-labelledby={daysId}>
              {DAYS.map((day) => (
                <Button
                  key={day.value}
                  variant={
                    form.daysOfWeek.includes(day.value) ? "default" : "outline"
                  }
                  size="sm"
                  className={cn(
                    "flex-1 min-w-0 px-0",
                    form.daysOfWeek.includes(day.value) && "ring-2 ring-ring/30"
                  )}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleSubmit}>
            {schedule ? "Save Changes" : "Create Schedule"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
