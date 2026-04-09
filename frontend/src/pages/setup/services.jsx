import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ServiceSection } from "@/components/service-section";
import { toastManager } from "@/components/ui/toast";
import { useServiceRegistry, useSetupServices, useTestService } from "@/hooks/use-api";
import { useSetupState, useSetupActions, useSetupNav } from "@/hooks/use-setup";

// Per-service guidance, surfaced as plain text under the relevant field.
const URL_HELP =
  "Auto-detected from your container name and default service port (Docker DNS). Edit only if your stack uses a non-standard host or port.";

const HELP_TEXT = {
  sonarr: {
    api_key: "Sonarr → Settings → General → Security → API Key.",
  },
  radarr: {
    api_key: "Radarr → Settings → General → Security → API Key.",
  },
  prowlarr: {
    api_key: "Prowlarr → Settings → General → Security → API Key.",
  },
  lidarr: {
    api_key: "Lidarr → Settings → General → Security → API Key.",
  },
  readarr: {
    api_key: "Readarr → Settings → General → Security → API Key.",
  },
  bazarr: {
    api_key: "Bazarr → Settings → General → Security → API Key.",
  },
  sabnzbd: {
    api_key: "SABnzbd → Config → General → Security → API Key (use the full API key, not the NZB key).",
  },
  nzbget: {
    username: "NZBGet → Settings → SECURITY → ControlUsername.",
    password: "NZBGet → Settings → SECURITY → ControlPassword.",
  },
  qbittorrent: {
    username: "qBittorrent → Tools → Options → Web UI → Authentication username.",
    password: "qBittorrent → Tools → Options → Web UI → Authentication password.",
  },
  transmission: {
    username: "Transmission → Edit → Preferences → Remote → Username.",
    password: "Transmission → Edit → Preferences → Remote → Password.",
  },
  deluge: {
    password: "Deluge Web UI password (default is `deluge`).",
  },
  plex: {
    token:
      "How to find your Plex token: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/",
  },
  jellyfin: {
    api_key: "Jellyfin → Dashboard → Advanced → API Keys → New API Key.",
  },
  emby: {
    api_key: "Emby → Dashboard → Advanced → API Keys → New API Key.",
  },
  tautulli: {
    api_key: "Tautulli → Settings → Web Interface → API Key.",
  },
  overseerr: {
    api_key: "Overseerr → Settings → General → API Key.",
  },
  jellyseerr: {
    api_key: "Jellyseerr → Settings → General → API Key.",
  },
};

function getFieldDefs(serviceType, serviceName) {
  if (!serviceType) return [];
  const fields = serviceType.fields || [];
  const labels = serviceType.field_labels || {};
  const help = HELP_TEXT[serviceName] || {};
  return fields.map((f) => ({
    key: f,
    label: labels[f] || f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, " "),
    placeholder: f === "url" ? "http://hostname:port" : "",
    helpText: f === "url" ? URL_HELP : help[f] || "",
  }));
}

export default function SetupServices() {
  const { data: registry } = useServiceRegistry();
  const { enabledServices, services } = useSetupState();
  const { setService } = useSetupActions();
  const { goBack, goNext } = useSetupNav("/setup/services");
  const setupServices = useSetupServices();
  const testService = useTestService();
  const [testResults, setTestResults] = useState({});
  const [isAdvancing, setIsAdvancing] = useState(false);

  const knownServices = registry?.services ?? {};
  const types = registry?.types ?? {};

  // Filter to only enabled services that exist in registry
  const enabledSvcList = enabledServices
    .map((name) => ({ name, ...knownServices[name] }))
    .filter((s) => s.type);

  const hasAtLeastOnePass = Object.values(testResults).some((r) => r?.ok);

  async function handleTestService(svcName, config) {
    try {
      const result = await testService.mutateAsync({ service: svcName, config });
      setTestResults((prev) => ({ ...prev, [svcName]: result }));
      return result;
    } catch {
      const result = { ok: false, message: "Test failed" };
      setTestResults((prev) => ({ ...prev, [svcName]: result }));
      return result;
    }
  }

  // Build a wrapped testService that tracks per-service results
  const wrappedTestService = {
    ...testService,
    mutateAsync: async ({ service, config }) => handleTestService(service, config),
  };

  async function handleNext() {
    if (enabledSvcList.length > 0 && !hasAtLeastOnePass) {
      toastManager.add({
        type: "warning",
        title: "No services tested",
        description: "Test at least one service connection before continuing, or skip remaining.",
      });
      return;
    }

    setIsAdvancing(true);
    try {
      // Build services payload, only include services with at least a URL
      const payload = {};
      for (const svc of enabledSvcList) {
        const cfg = services[svc.name] || {};
        if (cfg.url) {
          payload[svc.name] = cfg;
        }
      }

      if (Object.keys(payload).length > 0) {
        await setupServices.mutateAsync({ services: payload });
      }
      goNext();
    } catch (err) {
      toastManager.add({ type: "error", title: "Failed to save services", description: err.message });
    } finally {
      setIsAdvancing(false);
    }
  }

  function handleSkip() {
    toastManager.add({ type: "info", title: "Skipping services, you can configure them in Settings later." });
    goNext();
  }

  const isPending = setupServices.isPending || isAdvancing;

  if (enabledSvcList.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Configure Services</h2>
          <p className="text-sm text-muted-foreground">
            No services were selected in the previous step. You can enable services in Settings later.
          </p>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={goBack}>Back</Button>
          <Button onClick={goNext}>Next</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Configure Services</h2>
        <p className="text-sm text-muted-foreground">
          Enter connection details for your selected services. Test each one to confirm connectivity.
        </p>
      </div>

      <div className="space-y-3">
        {enabledSvcList.map((svc) => {
          const svcType = types[svc.type];
          return (
            <Card key={svc.name}>
              <CardContent className="p-4">
                <ServiceSection
                  title={svc.label || svc.name}
                  description={svc.description}
                  service={svc.name}
                  fields={getFieldDefs(svcType, svc.name)}
                  secretFields={svcType?.secret_fields ?? []}
                  config={services[svc.name] || {}}
                  setConfig={(cfg) => setService(svc.name, cfg)}
                  testService={wrappedTestService}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={goBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={isPending}>
            Skip remaining
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
