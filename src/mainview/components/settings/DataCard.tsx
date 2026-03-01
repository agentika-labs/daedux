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

  const handleFullSync = () => {
    syncMutation.mutate({ fullResync: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>Sync all sessions from scratch.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFullSync}
            disabled={syncMutation.isPending}
            aria-label="Run full resync"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn("size-4", syncMutation.isPending && "animate-spin")}
              data-icon="inline-start"
            />
            {syncMutation.isPending ? "Syncing..." : "Full Resync"}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <p className="text-muted-foreground text-sm">
          The dashboard normally syncs incrementally. Use this if costs seem off
          or you've changed pricing.
        </p>
      </CardContent>
    </Card>
  );
};
