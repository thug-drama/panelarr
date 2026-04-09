import { HardDriveIcon } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { formatSize } from "@/lib/utils";

function DiskRow({ disk, isSelected, onToggle }) {
  const usedPct = disk.pct ?? 0;
  const barColor =
    usedPct >= 90 ? "bg-destructive" : usedPct >= 85 ? "bg-warning" : "bg-primary";

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 p-3 transition-colors hover:border-primary/50 hover:bg-muted/40">
      <Switch checked={isSelected} onCheckedChange={() => onToggle(disk.mount)} />
      <HardDriveIcon className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{disk.mount}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatSize(disk.free)} free / {formatSize(disk.total)}
          </p>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.min(usedPct, 100)}%` }}
          />
        </div>
      </div>
    </label>
  );
}

/**
 * Renders a list of disks with per-row toggle switches.
 *
 * Used by both the setup wizard's system-check step and the Settings page so
 * the two surfaces share identical layout, switch styling, and percentage
 * colour ramps.
 */
export function DiskSelector({ disks, selected, onToggle, emptyMessage }) {
  if (!disks || disks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyMessage ?? "No disks detected."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {disks.map((disk) => (
        <DiskRow
          key={disk.mount}
          disk={disk}
          isSelected={selected.includes(disk.mount)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
