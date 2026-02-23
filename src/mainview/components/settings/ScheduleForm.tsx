import { useState } from "react";
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
import type { SessionSchedule } from "@shared/rpc-types";

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
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const formatHour = (hour: number): string => {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h} ${ampm}`;
};

export const ScheduleForm = ({ schedule, onSave, onCancel }: ScheduleFormProps) => {
  const [name, setName] = useState(schedule?.name ?? "");
  const [hour, setHour] = useState(schedule?.hour ?? 15);
  const [minute, setMinute] = useState(schedule?.minute ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    schedule?.daysOfWeek ?? [1, 2, 3, 4, 5] // Default to weekdays
  );
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
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
      name: name.trim(),
      hour,
      minute,
      daysOfWeek,
      enabled: schedule?.enabled ?? true,
    });
  };

  const handleSelectPreset = (preset: "weekdays" | "weekends" | "everyday") => {
    switch (preset) {
      case "weekdays":
        setDaysOfWeek([1, 2, 3, 4, 5]);
        break;
      case "weekends":
        setDaysOfWeek([0, 6]);
        break;
      case "everyday":
        setDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
        break;
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{schedule ? "Edit Schedule" : "New Schedule"}</AlertDialogTitle>
          <AlertDialogDescription>
            Configure when this warm-up session should run.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Name Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g., Before work"
              className="w-full h-9 px-3 rounded-xl border border-input bg-input/30 text-sm focus:border-ring focus:ring-ring/50 focus:ring-2 outline-none transition-colors"
            />
          </div>

          {/* Time Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Time</label>
            <div className="flex items-center gap-2">
              <Select value={hour.toString()} onValueChange={(v) => v && setHour(parseInt(v, 10))}>
                <SelectTrigger className="w-24">
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
              <Select value={minute.toString()} onValueChange={(v) => v && setMinute(parseInt(v, 10))}>
                <SelectTrigger className="w-20">
                  <SelectValue>{minute.toString().padStart(2, "0")}</SelectValue>
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

          {/* Day Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Days</label>
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
            <div className="flex gap-1.5">
              {DAYS.map((day) => (
                <Button
                  key={day.value}
                  variant={daysOfWeek.includes(day.value) ? "default" : "outline"}
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
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
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
