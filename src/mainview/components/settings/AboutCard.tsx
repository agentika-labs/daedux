import {
  Download04Icon,
  CheckmarkCircle02Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppInfo } from "@shared/rpc-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { rpcSend } from "@/hooks/useRPC";

interface AboutCardProps {
  appInfo: AppInfo | null;
  isLoading: boolean;
  isDesktop: boolean;
}

const AboutSkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-5 w-12" />
    </div>
    <Skeleton className="h-9 w-40" />
  </div>
);

export const AboutCard = ({
  appInfo,
  isLoading,
  isDesktop,
}: AboutCardProps) => {
  const handleDownload = () => {
    if (appInfo?.downloadUrl) {
      rpcSend("openExternal", { url: appInfo.downloadUrl });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Application information and updates.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <AboutSkeleton />
        ) : appInfo ? (
          <>
            {/* Version Display */}
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">Version</span>
              <span className="font-mono text-sm font-medium">
                {appInfo.version}
              </span>

              {/* Update Status Badge */}
              {appInfo.updateAvailable && appInfo.updateVersion ? (
                <Badge variant="success" className="gap-1">
                  <HugeiconsIcon icon={ArrowUp01Icon} className="size-3" />
                  {appInfo.updateVersion} available
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="size-3"
                  />
                  Up to date
                </Badge>
              )}
            </div>

            {/* Download Desktop App Button (only show in web/CLI mode) */}
            {!isDesktop && (
              <Button
                variant="outline"
                onClick={handleDownload}
                className="gap-2"
              >
                <HugeiconsIcon
                  icon={Download04Icon}
                  data-icon="inline-start"
                />
                Download Desktop App
              </Button>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Version information unavailable
          </p>
        )}
      </CardContent>
    </Card>
  );
};
