import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DiskSelector } from "@/components/disk-selector";
import { useSetupDisks, useSetupSystemCheck } from "@/hooks/use-api";
import { useSetupActions, useSetupNav, useSetupState } from "@/hooks/use-setup";

function CheckRow({ check }) {
  const icon = check.ok
    ? <CheckCircleIcon className="size-5 text-success" />
    : <XCircleIcon className="size-5 text-destructive" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{check.name}</p>
          <p className="text-xs text-muted-foreground break-all">{check.message}</p>
        </div>
      </div>
      {!check.ok && check.remediation && (
        <Alert variant="warning" className="ml-8">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>How to fix</AlertTitle>
          <AlertDescription>{check.remediation}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function SetupSystemCheck() {
  const { data, isLoading, isFetching } = useSetupSystemCheck();
  const qc = useQueryClient();
  const { goBack, goNext } = useSetupNav("/setup/system-check");
  const { selectedDisks } = useSetupState();
  const { setSelectedDisks, toggleDisk } = useSetupActions();
  const saveDisks = useSetupDisks();
  const [isSaving, setIsSaving] = useState(false);

  const checks = data?.checks ?? [];
  const disks = data?.disks ?? [];
  const dockerCheck = checks.find((c) => c.name?.toLowerCase().includes("docker"));
  const isDockerOk = dockerCheck?.ok ?? false;
  const allChecksRun = !isLoading && checks.length > 0;

  // Seed disk selection on first load: prefer server-saved selection,
  // otherwise default to all detected disks.
  useEffect(() => {
    if (!data) return;
    if (selectedDisks.length > 0) return;
    const initial = data.selected_disks?.length
      ? data.selected_disks
      : (data.disks ?? []).map((d) => d.mount);
    if (initial.length > 0) setSelectedDisks(initial);
  }, [data, selectedDisks.length, setSelectedDisks]);

  function handleRerun() {
    qc.invalidateQueries({ queryKey: ["setup-system-check"] });
  }

  async function handleNext() {
    setIsSaving(true);
    try {
      await saveDisks.mutateAsync({ mounts: selectedDisks });
      goNext();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">System Check</h2>
        <p className="text-sm text-muted-foreground">
          Verifying that your environment is ready for Panelarr.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}

      {allChecksRun && (
        <div className="space-y-4">
          {checks.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </div>
      )}

      {disks.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Disks to monitor</h3>
            <p className="text-xs text-muted-foreground">
              Choose which mounts to show on the dashboard. Defaults to all detected.
            </p>
          </div>
          <DiskSelector
            disks={disks}
            selected={selectedDisks}
            onToggle={toggleDisk}
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={goBack}>
            Back
          </Button>
          <Button variant="outline" onClick={handleRerun} disabled={isFetching}>
            {isFetching ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
            Re-run
          </Button>
        </div>
        <Button onClick={handleNext} disabled={!isDockerOk || isLoading || isSaving}>
          {isSaving ? <Spinner className="size-4" /> : null}
          Next
        </Button>
      </div>
    </div>
  );
}
