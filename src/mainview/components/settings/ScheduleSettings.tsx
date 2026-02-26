import {
  PlayIcon,
  PencilEdit02Icon,
  Delete02Icon,
  Add01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  SessionSchedule,
  AuthStatus,
  ExecutionResult,
  AppSettings,
} from "@shared/rpc-types";
import { useState, useEffect, useCallback } from "react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { rpcRequest } from "@/hooks/useRPC";

import { ScheduleForm } from "./ScheduleForm";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatTime = (hour: number, minute: number): string => {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, "0");
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
};

const formatDays = (days: number[]): string => {
  if (days.length === 7) {
    return "Every day";
  }
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) {
    return "Weekdays";
  }
  if (days.length === 2 && days.includes(0) && days.includes(6)) {
    return "Weekends";
  }
  return days.map((d) => DAY_NAMES[d]).join(", ");
};

export const ScheduleSettings = () => {
  const [schedules, setSchedules] = useState<SessionSchedule[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(
    null
  );
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] =
    useState<SessionSchedule | null>(null);
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [schedulesData, authData, settingsData] = await Promise.all([
        rpcRequest("getSchedules", {}),
        rpcRequest("getAuthStatus", {}),
        rpcRequest("getSettings", {}),
      ]);
      setSchedules(schedulesData);
      setAuthStatus(authData);
      setSettings(settingsData);
    } catch (error) {
      console.error("Failed to load schedule settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Toggle scheduler enabled
  const handleToggleScheduler = async () => {
    if (!settings) {
      return;
    }
    const newEnabled = !settings.schedulerEnabled;
    try {
      await rpcRequest("updateSettings", { schedulerEnabled: newEnabled });
      setSettings({ ...settings, schedulerEnabled: newEnabled });
    } catch (error) {
      console.error("Failed to toggle scheduler:", error);
    }
  };

  // Toggle individual schedule
  const handleToggleSchedule = async (schedule: SessionSchedule) => {
    try {
      await rpcRequest("updateSchedule", {
        id: schedule.id,
        patch: { enabled: !schedule.enabled },
      });
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === schedule.id ? { ...s, enabled: !s.enabled } : s
        )
      );
    } catch (error) {
      console.error("Failed to toggle schedule:", error);
    }
  };

  // Run schedule now
  const handleRunNow = async (scheduleId: string) => {
    try {
      setRunningScheduleId(scheduleId);
      const result: ExecutionResult = await rpcRequest("runScheduleNow", {
        id: scheduleId,
      });
      if (result.status === "success") {
        // Refresh schedules to update lastRunAt
        const updated = await rpcRequest("getSchedules", {});
        setSchedules(updated);
      } else if (result.status === "error" || result.status === "skipped") {
        console.warn("Schedule run failed:", result.error);
      }
    } catch (error) {
      console.error("Failed to run schedule:", error);
    } finally {
      setRunningScheduleId(null);
    }
  };

  // Delete schedule
  const handleDelete = async () => {
    if (!deleteScheduleId) {
      return;
    }
    try {
      await rpcRequest("deleteSchedule", { id: deleteScheduleId });
      setSchedules((prev) => prev.filter((s) => s.id !== deleteScheduleId));
    } catch (error) {
      console.error("Failed to delete schedule:", error);
    } finally {
      setDeleteScheduleId(null);
    }
  };

  // Create/update schedule
  const handleSaveSchedule = async (input: {
    name: string;
    hour: number;
    minute: number;
    daysOfWeek: number[];
    enabled?: boolean;
  }) => {
    try {
      if (editingSchedule) {
        await rpcRequest("updateSchedule", {
          id: editingSchedule.id,
          patch: input,
        });
      } else {
        await rpcRequest("createSchedule", input);
      }
      const updated = await rpcRequest("getSchedules", {});
      setSchedules(updated);
      setShowForm(false);
      setEditingSchedule(null);
    } catch (error) {
      console.error("Failed to save schedule:", error);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <HugeiconsIcon
              icon={Loading03Icon}
              className="text-muted-foreground size-6 animate-spin"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Session Warm-Up</CardTitle>
          <CardDescription>
            Pre-start your usage window on a schedule.
          </CardDescription>
          <CardAction>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={
                      settings?.schedulerEnabled ? "success" : "destructive"
                    }
                    size="sm"
                    onClick={handleToggleScheduler}
                    disabled={
                      schedules.length === 0 && !settings?.schedulerEnabled
                    }
                  >
                    {settings?.schedulerEnabled ? "Enabled" : "Disabled"}
                  </Button>
                }
              />
              {schedules.length === 0 && !settings?.schedulerEnabled && (
                <TooltipContent>Add a schedule first</TooltipContent>
              )}
            </Tooltip>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Auth Status */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Auth Status</span>
              {authStatus?.loggedIn ? (
                <Badge variant="success" className="gap-1.5">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="size-3"
                  />
                  Logged in
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1.5">
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  Not logged in
                </Badge>
              )}
            </div>
            {authStatus?.loggedIn && authStatus.email && (
              <p className="text-muted-foreground truncate text-xs">
                {authStatus.email}
              </p>
            )}
          </div>

          {!authStatus?.loggedIn && (
            <p className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-sm">
              You need to be logged into Claude CLI for warm-ups to work. Run{" "}
              <code className="bg-muted rounded px-1.5 py-0.5">
                claude auth login
              </code>{" "}
              in your terminal.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Schedules Card */}
      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
          <CardDescription>Configure when warm-ups run.</CardDescription>
          <CardAction>
            <Button
              size="sm"
              onClick={() => {
                setEditingSchedule(null);
                setShowForm(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              Add Schedule
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {schedules.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              <p>No schedules configured yet.</p>
              <p className="mt-1 text-sm">
                Add a schedule to automatically warm up your usage window.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.name}
                    </TableCell>
                    <TableCell>
                      {formatTime(schedule.hour, schedule.minute)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDays(schedule.daysOfWeek)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant={schedule.enabled ? "default" : "outline"}
                        size="xs"
                        onClick={() => handleToggleSchedule(schedule)}
                      >
                        {schedule.enabled ? "On" : "Off"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRunNow(schedule.id)}
                          disabled={
                            runningScheduleId === schedule.id ||
                            !authStatus?.loggedIn
                          }
                          title="Run now"
                        >
                          {runningScheduleId === schedule.id ? (
                            <HugeiconsIcon
                              icon={Loading03Icon}
                              className="size-4 animate-spin"
                            />
                          ) : (
                            <HugeiconsIcon icon={PlayIcon} className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditingSchedule(schedule);
                            setShowForm(true);
                          }}
                          title="Edit"
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            className="size-4"
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteScheduleId(schedule.id)}
                          title="Delete"
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            className="size-4"
                          />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Schedule Form Modal */}
      {showForm && (
        <ScheduleForm
          schedule={editingSchedule}
          onSave={handleSaveSchedule}
          onCancel={() => {
            setShowForm(false);
            setEditingSchedule(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteScheduleId !== null}
        onOpenChange={(open) => !open && setDeleteScheduleId(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
