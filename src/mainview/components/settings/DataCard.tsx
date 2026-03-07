import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSyncMutation } from "@/queries/dashboard";

export const DataCard = () => {
  const syncMutation = useSyncMutation();

  const handleSync = (fullResync: boolean) => {
    syncMutation.mutate({ fullResync });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>Sync sessions from Claude Code logs.</CardDescription>
        <CardAction className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSync(false)}
            disabled={syncMutation.isPending}
            aria-label="Run incremental sync"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn("size-4", syncMutation.isPending && "animate-spin")}
              data-icon="inline-start"
            />
            Sync Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSync(true)}
            disabled={syncMutation.isPending}
            aria-label="Run full resync"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn("size-4", syncMutation.isPending && "animate-spin")}
              data-icon="inline-start"
            />
            Full Resync
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <p className="text-muted-foreground text-sm">
          <strong>Sync Now</strong> picks up new sessions incrementally.{" "}
          <strong>Full Resync</strong> rebuilds from scratch. Use if costs seem
          off or you've changed pricing.
        </p>
      </CardContent>
    </Card>
  );
};
