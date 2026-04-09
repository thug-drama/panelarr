import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useSetupThresholds } from "@/hooks/use-api";
import { useSetupState, useSetupActions, useSetupNav } from "@/hooks/use-setup";

export default function SetupThresholds() {
  const { thresholds } = useSetupState();
  const { setThresholds } = useSetupActions();
  const { goBack, goNext } = useSetupNav("/setup/thresholds");
  const setupThresholds = useSetupThresholds();
  const [isAdvancing, setIsAdvancing] = useState(false);

  function handleChange(key, value) {
    setThresholds({ [key]: Number(value) });
  }

  async function handleNext() {
    setIsAdvancing(true);
    try {
      await setupThresholds.mutateAsync(thresholds);
      goNext();
    } catch (err) {
      toastManager.add({ type: "error", title: "Failed to save thresholds", description: err.message });
    } finally {
      setIsAdvancing(false);
    }
  }

  function handleSkip() {
    goNext();
  }

  const isPending = setupThresholds.isPending || isAdvancing;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Alerts &amp; Thresholds</h2>
        <p className="text-sm text-muted-foreground">
          Configure when Panelarr triggers disk and stalled-download alerts. Defaults work well for most setups.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="disk-warn">Disk Warning (%)</Label>
          <Input
            id="disk-warn"
            type="number"
            min={50}
            max={99}
            value={thresholds.disk_warn_pct}
            onChange={(e) => handleChange("disk_warn_pct", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Disk usage level that triggers a warning alert. Default: 85%.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="disk-crit">Disk Critical (%)</Label>
          <Input
            id="disk-crit"
            type="number"
            min={50}
            max={99}
            value={thresholds.disk_crit_pct}
            onChange={(e) => handleChange("disk_crit_pct", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Disk usage level that triggers a critical alert. Default: 90%.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="watchdog-hours">Watchdog Stall (hours)</Label>
          <Input
            id="watchdog-hours"
            type="number"
            min={1}
            max={72}
            value={thresholds.watchdog_threshold_hours}
            onChange={(e) => handleChange("watchdog_threshold_hours", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Downloads in the queue longer than this are flagged as stalled. Default: 2 hours.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={goBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={isPending}>
            Skip
          </Button>
          <Button onClick={handleNext} disabled={isPending}>
            {isPending ? <Spinner className="size-4" /> : null}
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
