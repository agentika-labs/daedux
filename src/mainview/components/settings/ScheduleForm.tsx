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
  const [name, setName] = useState(schedule?.name ?? "");
  const [hour, setHour] = useState(schedule?.hour ?? 15);
  const [minute, setMinute] = useState(schedule?.minute ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    schedule?.daysOfWeek ?? [1, 2, 3, 4, 5] // Default to weekdays
  );
  const [error, setError] = useState<string | null>(null);

  const nameId = useId();
  const timeId = useId();
  const daysId = useId();

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].toSorted()
    );
  };

  const handleSubmit = () => {
    // Validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (daysOfWeek.length === 0) {
      setError("Select at least one day");
      return;
    }

    onSave({
      daysOfWeek,
      enabled: schedule?.enabled ?? true,
      hour,
      minute,
      name: name.trim(),
    });
  };

  const handleSelectPreset = (preset: "weekdays" | "weekends" | "everyday") => {
    switch (preset) {
      case "weekdays": {
        setDaysOfWeek([1, 2, 3, 4, 5]);
        break;
      }
      case "weekends": {
        setDaysOfWeek([0, 6]);
        break;
      }
      case "everyday": {
        setDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
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
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g., Before work"
              className="border-input bg-input/30 focus:border-ring focus:ring-ring/50 h-9 w-full rounded-xl border px-3 text-sm transition-colors outline-none focus:ring-2"
            />
          </div>

          {/* Time Selection - uses aria-labelledby for composite control (WAI-ARIA 1.2 pattern for groups of related inputs) */}
          <div className="space-y-2">
            <label id={timeId} className="text-sm font-medium">
              Time
            </label>
            <div className="flex items-center gap-2" aria-labelledby={timeId}>
              <Select
                value={hour.toString()}
                onValueChange={(v) => v && setHour(Number.parseInt(v, 10))}
              >
                <SelectTrigger className="w-24" aria-labelledby={timeId}>
                  <SelectValue>{formatHour(hour)}</SelectValue>
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
                value={minute.toString()}
                onValueChange={(v) => v && setMinute(Number.parseInt(v, 10))}
              >
                <SelectTrigger className="w-20" aria-labelledby={timeId}>
                  <SelectValue>
                    {minute.toString().padStart(2, "0")}
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
              <label id={daysId} className="text-sm font-medium">
                Days
              </label>
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
                    daysOfWeek.includes(day.value) ? "default" : "outline"
                  }
                  size="sm"
                  className={cn(
                    "flex-1 min-w-0 px-0",
                    daysOfWeek.includes(day.value) && "ring-2 ring-ring/30"
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
