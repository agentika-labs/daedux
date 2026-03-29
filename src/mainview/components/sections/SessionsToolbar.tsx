import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SessionsToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  showSubagents: boolean;
  onToggleSubagents: () => void;
}

export const SessionsToolbar = React.memo(function SessionsToolbar({
  searchInput,
  onSearchChange,
  showSubagents,
  onToggleSubagents,
}: SessionsToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      {/* Search Input */}
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
        />
        <Input
          placeholder="Search sessions..."
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-[200px] pl-8"
        />
      </div>
      <Button
        variant={showSubagents ? "default" : "outline"}
        size="sm"
        onClick={onToggleSubagents}
      >
        {showSubagents ? "Hide" : "Show"} Subagents
      </Button>
    </div>
  );
});
