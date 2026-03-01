import {
  Moon02Icon,
  Sun03Icon,
  ComputerSettingsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppSettings } from "@shared/rpc-types";

import { cn } from "@/lib/utils";

type ThemeMode = AppSettings["theme"];

interface ThemeToggleProps {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
  disabled?: boolean;
}

interface ThemeOption {
  value: ThemeMode;
  label: string;
  icon: typeof Sun03Icon;
}

const THEME_OPTIONS: ThemeOption[] = [
  { icon: ComputerSettingsIcon, label: "System", value: "system" },
  { icon: Sun03Icon, label: "Light", value: "light" },
  { icon: Moon02Icon, label: "Dark", value: "dark" },
];

export const ThemeToggle = ({
  value,
  onChange,
  disabled = false,
}: ThemeToggleProps) => {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = index;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      newIndex = (index + 1) % THEME_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      newIndex = (index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const currentOption = THEME_OPTIONS[index];
      if (currentOption) {
        onChange(currentOption.value);
      }
      return;
    } else {
      return;
    }

    const option = THEME_OPTIONS[newIndex];
    if (option) {
      onChange(option.value);
    }
    // Focus the new button
    const buttons = e.currentTarget.parentElement?.querySelectorAll("button");
    const targetButton = buttons?.[newIndex];
    if (targetButton instanceof HTMLElement) {
      targetButton.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      className="bg-muted inline-flex items-center rounded-lg p-1"
    >
      {THEME_OPTIONS.map((option, index) => {
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150",
              "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              isSelected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <HugeiconsIcon icon={option.icon} className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
