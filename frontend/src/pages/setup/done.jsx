import { CheckCircleIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useConfig, useSetupComplete } from "@/hooks/use-api";
import { useSetupState, useSetupActions } from "@/hooks/use-setup";

export default function SetupDone() {
  const navigate = useNavigate();
  const { auth, notification } = useSetupState();
  const { reset } = useSetupActions();
  const completeSetup = useSetupComplete();
  const { data: savedConfig } = useConfig();

  const authLabel = {
    none: "No authentication",
    basic: "Username & password",
    proxy: "Reverse proxy",
    apikey: "API key",
  }[auth.mode] ?? auth.mode;

  // Count what's actually persisted on the backend, not what's sitting in
  // the wizard's in-memory form state. URLs are auto-prefilled from discovery,
  // so wizard state can have URLs for services the user never tested or saved.
  // The backend only ever has services that POSTed through /api/setup/services.
  const savedServices = savedConfig?.services ?? {};
  const serviceCount = Object.values(savedServices).filter(
    (cfg) => (cfg?.url ?? "").toString().trim() !== "",
  ).length;

  // Read notification channels from the persisted config, same reasoning as
  // services above. The wizard state may carry a half-filled draft that
  // never made it to /api/setup/notifications.
  const savedChannels = savedConfig?.notifications?.channels ?? [];
  const notificationLabel = (() => {
    if (savedChannels.length === 0) return null;
    if (savedChannels.length === 1) {
      const ch = savedChannels[0];
      const type = (ch?.type ?? "").toString();
      const label = type.charAt(0).toUpperCase() + type.slice(1) || "Channel";
      return `${label} configured`;
    }
    return `${savedChannels.length} channels configured`;
  })();
  const hasNotification = notificationLabel !== null;
  // Silence unused-var warning, notification still comes from wizard state
  // for potential future use.
  void notification;

  async function handleFinish() {
    try {
      const result = await completeSetup.mutateAsync();
      reset();
      toastManager.add({ type: "success", title: "Setup complete! Welcome to Panelarr." });

      // If basic auth was set up, redirect to login page
      if (auth.mode === "basic") {
        navigate("/login", { replace: true });
      } else {
        const target = result?.redirect ?? "/";
        // Only allow relative paths starting with / (not //) to prevent open redirects
        const safeTarget = typeof target === "string" && target.startsWith("/") && !target.startsWith("//") ? target : "/";
        navigate(safeTarget, { replace: true });
      }
    } catch (err) {
      toastManager.add({ type: "error", title: "Failed to complete setup", description: err.message });
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Setup Complete</h2>
        <p className="text-sm text-muted-foreground">
          Here is a summary of what was configured. Click Open Dashboard to get started.
        </p>
      </div>

      <div className="rounded-lg border divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted-foreground">Authentication</span>
          <Badge variant="outline">{authLabel}</Badge>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted-foreground">Services configured</span>
          <Badge variant={serviceCount > 0 ? "default" : "secondary"}>
            {serviceCount > 0
              ? `${serviceCount} service${serviceCount !== 1 ? "s" : ""}`
              : "None, add later in Settings"}
          </Badge>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted-foreground">Notifications</span>
          <Badge variant={hasNotification ? "success" : "secondary"}>
            {hasNotification ? notificationLabel : "None"}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
        <CheckCircleIcon className="size-5 text-success shrink-0" />
        <p className="text-sm">
          Your media server control center is ready. You can update any of these settings at any time from the Settings page.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleFinish} disabled={completeSetup.isPending}>
          {completeSetup.isPending ? <Spinner className="size-4" /> : null}
          Open Dashboard
        </Button>
      </div>
    </div>
  );
}
