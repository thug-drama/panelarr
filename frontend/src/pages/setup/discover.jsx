import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useSetupDiscover } from "@/hooks/use-api";
import { useSetupState, useSetupActions, useSetupNav } from "@/hooks/use-setup";

function MatchRow({ match, isEnabled, onToggle }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Switch
        checked={isEnabled}
        onCheckedChange={onToggle}
        id={`discover-${match.service}`}
        aria-label={`Enable ${match.service}`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{match.label || match.service}</p>
        <p className="text-xs text-muted-foreground truncate">{match.container_name}</p>
      </div>
    </div>
  );
}

export default function SetupDiscover() {
  const { data, isLoading, isFetching } = useSetupDiscover();
  const qc = useQueryClient();
  const { enabledServices, services, discoverSeeded } = useSetupState();
  const { toggleService, setEnabledServices, setService, markDiscoverSeeded } = useSetupActions();
  const { goBack, goNext } = useSetupNav("/setup/discover");

  const [manualService, setManualService] = useState("");

  const matches = data?.matches ?? [];
  const knownServices = data?.known_services ?? [];
  const detectedNames = matches.map((m) => m.service);

  // On first wizard-session data load (tracked via reducer state, not a ref,
  // so it survives component remounts but resets on wizard reset):
  //   1. Prune any stale enabledServices entries left over from a previous
  //      wizard session that aren't currently detected. sessionStorage can
  //      outlive a backend reset, so we drop ghosts like qbit/sab.
  //   2. Seed all detected matches.
  //   3. Pre-fill suggested_url into wizard state for each detected match.
  useEffect(() => {
    if (!data || discoverSeeded) return;

    const detected = matches.map((m) => m.service);

    // Drop anything not currently detected, this wipes ghosts from a previous
    // session. Within the same session, manual additions still persist because
    // this effect only fires once (gated by discoverSeeded).
    const pruned = enabledServices.filter((name) => detected.includes(name));
    const next = pruned.length > 0 ? pruned : detected;
    if (
      next.length !== enabledServices.length ||
      next.some((n, i) => n !== enabledServices[i])
    ) {
      setEnabledServices(next);
    }

    matches.forEach((match) => {
      if (match.suggested_url && !services[match.service]?.url) {
        setService(match.service, { url: match.suggested_url });
      }
    });

    markDiscoverSeeded();
  // Only run when data loads, ignore enabledServices/services to avoid loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, discoverSeeded]);

  function handleAddManual() {
    if (!manualService) return;
    const svc = knownServices.find((s) => s.service === manualService);
    if (!svc) return;
    if (!enabledServices.includes(manualService)) {
      setEnabledServices([...enabledServices, manualService]);
    }
    setManualService("");
  }

  function handleRerun() {
    qc.invalidateQueries({ queryKey: ["setup-discover"] });
  }

  const undetected = knownServices.filter(
    (s) => !detectedNames.includes(s.service) && !enabledServices.includes(s.service),
  );

  const manuallyAdded = enabledServices.filter((name) => !detectedNames.includes(name));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Discover Services</h2>
        <p className="text-sm text-muted-foreground">
          We scanned your running containers and matched them to known services.
          Toggle each service you want to configure.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}

      {!isLoading && matches.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No known media services were detected. You can add them manually below.
        </p>
      )}

      {!isLoading && matches.length > 0 && (
        <div className="space-y-2">
          {matches.map((match) => (
            <MatchRow
              key={match.service}
              match={match}
              isEnabled={enabledServices.includes(match.service)}
              onToggle={() => toggleService(match.service)}
            />
          ))}
        </div>
      )}

      {/* Manually added services not in detected list */}
      {manuallyAdded.length > 0 && (
        <div className="space-y-2">
          {manuallyAdded.map((name) => {
            const svc = knownServices.find((s) => s.service === name);
            return (
              <div key={name} className="flex items-center gap-3 rounded-lg border border-dashed p-3">
                <Switch
                  checked
                  onCheckedChange={() => toggleService(name)}
                  id={`manual-${name}`}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{svc?.label || name}</p>
                  <p className="text-xs text-muted-foreground">Added manually</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add manually */}
      {!isLoading && undetected.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Add manually
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="manual-service" className="sr-only">Service</Label>
              <select
                id="manual-service"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={manualService}
                onChange={(e) => setManualService(e.target.value)}
              >
                <option value="">Select a service to add...</option>
                {undetected.map((s) => (
                  <option key={s.service} value={s.service}>
                    {s.label || s.service}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={handleAddManual} disabled={!manualService}>
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={goBack}>
            Back
          </Button>
          <Button variant="outline" size="sm" onClick={handleRerun} disabled={isFetching}>
            {isFetching ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
            Rescan
          </Button>
        </div>
        <Button onClick={goNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
