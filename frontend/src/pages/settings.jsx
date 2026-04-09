import { useEffect, useState } from "react";
import {
  BellIcon,
  HardDriveIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldIcon,
  TrashIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AuthSection } from "@/components/auth-section";
import { DiskSelector } from "@/components/disk-selector";
import { SecretInput } from "@/components/secret-input";
import { ServiceSection } from "@/components/service-section";
import { useAuth } from "@/hooks/use-auth";
import {
  useAddChannel,
  useAddRule,
  useAllDisks,
  useConfig,
  useDeleteChannel,
  useDeleteRule,
  useNotificationChannels,
  useNotificationRules,
  useRegenerateApiKey,
  useServiceRegistry,
  useSetupReset,
  useTestChannel,
  useTestChannelDraft,
  useTestService,
  useUpdateAuthConfig,
  useUpdateConfig,
} from "@/hooks/use-api";

// Generate field definitions from registry type
function getFieldDefs(serviceType) {
  if (!serviceType) return [];
  const fields = serviceType.fields || [];
  const labels = serviceType.field_labels || {};
  return fields.map((f) => ({
    key: f,
    label: labels[f] || f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, " "),
    placeholder: f === "url" ? `http://${f}:port` : "",
  }));
}

const CHANNEL_TYPES = [
  {
    value: "discord",
    label: "Discord",
    name_placeholder: "e.g. My Discord Server",
    fields: [{ key: "webhook_url", label: "Webhook URL", secret: true }],
  },
  {
    value: "telegram",
    label: "Telegram",
    name_placeholder: "e.g. Homelab Bot",
    fields: [
      { key: "bot_token", label: "Bot Token", secret: true },
      { key: "chat_id", label: "Chat ID" },
    ],
  },
  {
    value: "slack",
    label: "Slack",
    name_placeholder: "e.g. #alerts",
    fields: [{ key: "webhook_url", label: "Webhook URL", secret: true }],
  },
  {
    value: "webhook",
    label: "Generic Webhook",
    name_placeholder: "e.g. My Webhook",
    fields: [{ key: "url", label: "URL" }],
  },
  {
    value: "email",
    label: "Email (SMTP)",
    name_placeholder: "e.g. Alerts Mailbox",
    fields: [
      { key: "smtp_host", label: "SMTP Host", placeholder: "smtp.example.com" },
      { key: "smtp_port", label: "SMTP Port", type: "number", placeholder: "587", default: "587" },
      {
        key: "encryption",
        label: "Encryption",
        type: "select",
        default: "starttls",
        options: [
          { value: "starttls", label: "STARTTLS (typically port 587)" },
          { value: "ssl", label: "SSL/TLS (typically port 465)" },
          { value: "none", label: "None (typically port 25)" },
        ],
      },
      { key: "username", label: "Username", placeholder: "user@example.com" },
      { key: "password", label: "Password", secret: true },
      { key: "from_addr", label: "From Address", placeholder: "panelarr@example.com" },
      { key: "to_addrs", label: "To Address(es)", placeholder: "alerts@example.com, ops@example.com" },
    ],
  },
];

const EVENT_TYPES = [
  { value: "health_check", label: "Health Check", description: "System health summary, triggered manually from the dashboard", cooldown: "No cooldown (manual only)" },
  { value: "disk_warning", label: "Disk Warning", description: "Fires when any disk exceeds the warning threshold", cooldown: "Max once per hour" },
  { value: "disk_critical", label: "Disk Critical", description: "Fires when any disk exceeds the critical threshold", cooldown: "Max once per 30 minutes" },
];

function NotificationsSection() {
  const { data: channels = [] } = useNotificationChannels();
  const { data: rules = [] } = useNotificationRules();
  const addChannel = useAddChannel();
  const deleteChannel = useDeleteChannel();
  const testChannel = useTestChannel();
  const testChannelDraft = useTestChannelDraft();
  const addRule = useAddRule();
  const deleteRule = useDeleteRule();

  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newChannelType, setNewChannelType] = useState("discord");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelConfig, setNewChannelConfig] = useState({});
  const [newRuleEvent, setNewRuleEvent] = useState("health_check");
  const [newRuleChannelId, setNewRuleChannelId] = useState("");

  function handleAddChannel() {
    if (!newChannelName) return;
    addChannel.mutate({
      type: newChannelType,
      name: newChannelName,
      config: newChannelConfig,
    });
    setNewChannelName("");
    setNewChannelConfig({});
    setShowAddChannel(false);
  }

  function handleAddRule() {
    if (!newRuleChannelId) return;
    addRule.mutate({
      event: newRuleEvent,
      channel_id: newRuleChannelId,
    });
    setShowAddRule(false);
  }

  const typeDef = CHANNEL_TYPES.find((t) => t.value === newChannelType);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Channels */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Channels</h3>
            <Button variant="outline" size="sm" onClick={() => setShowAddChannel(!showAddChannel)}>
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </div>

          {showAddChannel && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1">Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={newChannelType}
                    onChange={(e) => {
                      const next = e.target.value;
                      setNewChannelType(next);
                      const def = CHANNEL_TYPES.find((t) => t.value === next);
                      const seeded = {};
                      def?.fields.forEach((f) => {
                        if (f.default !== undefined) seeded[f.key] = f.default;
                      });
                      setNewChannelConfig(seeded);
                    }}
                  >
                    {CHANNEL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="mb-1">Name</Label>
                  <Input
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder={typeDef?.name_placeholder || "Channel name"}
                  />
                </div>
              </div>
              {typeDef?.fields.map((f) => {
                if (f.type === "checkbox") {
                  return (
                    <label key={f.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={Boolean(newChannelConfig[f.key])}
                        onChange={(e) =>
                          setNewChannelConfig({ ...newChannelConfig, [f.key]: e.target.checked })
                        }
                      />
                      {f.label}
                    </label>
                  );
                }
                if (f.type === "select") {
                  return (
                    <div key={f.key}>
                      <Label className="mb-1">{f.label}</Label>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={newChannelConfig[f.key] ?? f.default ?? ""}
                        onChange={(e) =>
                          setNewChannelConfig({ ...newChannelConfig, [f.key]: e.target.value })
                        }
                      >
                        {f.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                return (
                  <div key={f.key}>
                    <Label className="mb-1">{f.label}</Label>
                    {f.secret ? (
                      <SecretInput
                        value={newChannelConfig[f.key] || ""}
                        onChange={(e) => setNewChannelConfig({ ...newChannelConfig, [f.key]: e.target.value })}
                        placeholder={f.placeholder || f.label}
                      />
                    ) : (
                      <Input
                        type={f.type === "number" ? "number" : "text"}
                        value={newChannelConfig[f.key] ?? ""}
                        onChange={(e) => setNewChannelConfig({ ...newChannelConfig, [f.key]: e.target.value })}
                        placeholder={f.placeholder || f.label}
                      />
                    )}
                  </div>
                );
              })}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddChannel} disabled={addChannel.isPending}>
                  {addChannel.isPending ? <Spinner className="size-4" /> : null}
                  Add Channel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    testChannelDraft.mutate({
                      type: newChannelType,
                      name: newChannelName || "Draft",
                      config: newChannelConfig,
                    })
                  }
                  disabled={testChannelDraft.isPending}
                >
                  {testChannelDraft.isPending ? <Spinner className="size-4" /> : <SendIcon className="size-3.5" />}
                  Test
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowAddChannel(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {channels.length === 0 && !showAddChannel && (
            <p className="text-sm text-muted-foreground">No notification channels configured. Add one to start receiving alerts.</p>
          )}

          {channels.map((ch) => (
            <div key={ch.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{ch.type}</Badge>
                <span className="text-sm font-medium">{ch.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => testChannel.mutate(ch.id)}
                  disabled={testChannel.isPending}
                  title="Test"
                >
                  <SendIcon className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive"
                  onClick={() => deleteChannel.mutate(ch.id)}
                  title="Remove"
                >
                  <TrashIcon className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Separator />

        {/* Rules */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Alert Rules</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddRule(!showAddRule)}
              disabled={channels.length === 0}
            >
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Rules determine which events get sent to which channels. Each event type has a cooldown period to prevent notification spam.
          </p>

          {showAddRule && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1">Event</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={newRuleEvent}
                    onChange={(e) => setNewRuleEvent(e.target.value)}
                  >
                    {EVENT_TYPES.map((ev) => (
                      <option key={ev.value} value={ev.value}>{ev.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="mb-1">Channel</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={newRuleChannelId}
                    onChange={(e) => setNewRuleChannelId(e.target.value)}
                  >
                    <option value="">Select channel...</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name} ({ch.type})</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {EVENT_TYPES.find((e) => e.value === newRuleEvent)?.description}
                {" · "}
                <span className="font-medium">{EVENT_TYPES.find((e) => e.value === newRuleEvent)?.cooldown}</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddRule} disabled={addRule.isPending || !newRuleChannelId}>
                  {addRule.isPending ? <Spinner className="size-4" /> : null}
                  Add Rule
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowAddRule(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {rules.map((rule) => {
            const ch = channels.find((c) => c.id === rule.channel_id);
            const ev = EVENT_TYPES.find((e) => e.value === rule.event);
            return (
              <div key={rule.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="default" className="text-[10px]">{ev?.label || rule.event}</Badge>
                  <span className="text-muted-foreground">→</span>
                  <span>{ch?.name || "Unknown channel"}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive"
                  onClick={() => deleteRule.mutate(rule.id)}
                >
                  <TrashIcon className="size-3" />
                </Button>
              </div>
            );
          })}

          {rules.length === 0 && !showAddRule && (
            <p className="text-sm text-muted-foreground">
              {channels.length === 0
                ? "Add a channel first, then create rules to receive notifications."
                : "No rules configured. Add a rule to start receiving alerts."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { data: savedConfig, isLoading: configLoading } = useConfig();
  const { data: registry, isLoading: registryLoading } = useServiceRegistry();
  const updateConfig = useUpdateConfig();
  const testService = useTestService();

  // Dynamic service configs, keyed by service name
  const [serviceConfigs, setServiceConfigs] = useState({});
  const [initiallyConfigured, setInitiallyConfigured] = useState(new Set());

  useEffect(() => {
    if (!savedConfig || !registry) return;

    const configs = {};
    const knownServices = registry.services || {};

    // All services live in savedConfig.services now (v2 format)
    const savedServices = savedConfig.services || {};
    for (const [name, info] of Object.entries(knownServices)) {
      const svcType = registry.types?.[info.type];
      const fields = svcType?.fields || [];
      const saved = savedServices[name] || {};
      const cfg = {};
      for (const f of fields) {
        cfg[f] = saved[f] || "";
      }
      configs[name] = cfg;
    }

    setServiceConfigs(configs);
    const initial = new Set();
    for (const [name, cfg] of Object.entries(configs)) {
      if (cfg.url) initial.add(name);
    }
    setInitiallyConfigured(initial);
  }, [savedConfig, registry]);

  function handleSaveServices() {
    // Build clean v2 config structure, services key replaces entirely
    const services = {};
    for (const [name, cfg] of Object.entries(serviceConfigs)) {
      const hasValue = Object.values(cfg).some((v) => v && v !== "");
      if (hasValue) {
        services[name] = cfg;
      }
    }

    updateConfig.mutate(
      { services },
      {
        onSuccess: () => {
          // Update initiallyConfigured to reflect removals
          const next = new Set();
          for (const [name, cfg] of Object.entries(serviceConfigs)) {
            if (Object.values(cfg).some((v) => v && v !== "")) next.add(name);
          }
          setInitiallyConfigured(next);
          toastManager.add({ type: "success", title: "Services saved" });
        },
        onError: (err) => {
          toastManager.add({
            type: "error",
            title: "Failed to save services",
            description: err.message,
          });
        },
      },
    );
  }

  if (configLoading || registryLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  // Group services by category
  const categories = registry?.categories || {};
  const knownServices = registry?.services || {};
  const types = registry?.types || {};

  const grouped = {};
  for (const [name, info] of Object.entries(knownServices)) {
    const cat = info.category || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ name, ...info });
  }

  const sortedCategories = Object.entries(grouped).sort(
    ([a], [b]) => (categories[a]?.order ?? 99) - (categories[b]?.order ?? 99),
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Each section saves independently. Changes only take effect after you click
          its save button.
        </p>
      </div>

      {/* Authentication */}
      <AuthCard />

      {/* Services, one card wrapping every category */}
      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {sortedCategories.map(([categoryKey, services], catIdx) => {
            // Use initial state for layout stability, prevents components
            // from jumping between configured/unconfigured sections while typing
            const configured = services.filter(
              (svc) => initiallyConfigured.has(svc.name),
            );
            const unconfigured = services.filter(
              (svc) => !initiallyConfigured.has(svc.name),
            );

            return (
              <section key={categoryKey} className="space-y-4">
                {catIdx > 0 && <Separator />}
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {categories[categoryKey]?.label || categoryKey}
                </h3>
                <div className="space-y-6">
                  {configured.map((svc, i) => {
                    const svcType = types[svc.type];
                    return (
                      <div key={svc.name}>
                        {i > 0 && <Separator className="mb-6" />}
                        <ServiceSection
                          title={svc.label}
                          description={svc.description}
                          service={svc.name}
                          config={serviceConfigs[svc.name] || {}}
                          setConfig={(cfg) =>
                            setServiceConfigs((prev) => ({ ...prev, [svc.name]: cfg }))
                          }
                          testService={testService}
                          secretFields={svcType?.secret_fields || []}
                          fields={getFieldDefs(svcType)}
                          autoTest
                        />
                      </div>
                    );
                  })}
                  {configured.length === 0 && (
                    <p className="text-sm text-muted-foreground">No services configured in this category.</p>
                  )}
                  {unconfigured.length > 0 && (
                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground select-none">
                        <span className="transition-transform group-open:rotate-90">▶</span>
                        Add {unconfigured.map((s) => s.label).join(", ")}
                      </summary>
                      <div className="mt-4 space-y-6">
                        {unconfigured.map((svc, i) => {
                          const svcType = types[svc.type];
                          return (
                            <div key={svc.name}>
                              {i > 0 && <Separator className="mb-6" />}
                              <ServiceSection
                                title={svc.label}
                                description={svc.description}
                                service={svc.name}
                                config={serviceConfigs[svc.name] || {}}
                                setConfig={(cfg) =>
                                  setServiceConfigs((prev) => ({ ...prev, [svc.name]: cfg }))
                                }
                                testService={testService}
                                secretFields={svcType?.secret_fields || []}
                                fields={getFieldDefs(svcType)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              </section>
            );
          })}

          <Separator />

          <div className="flex justify-end">
            <Button onClick={handleSaveServices} disabled={updateConfig.isPending}>
              {updateConfig.isPending ? <Spinner className="size-4" /> : null}
              Save services
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <NotificationsSection />

      {/* Disks to monitor */}
      <DisksCard savedDisks={savedConfig?.thresholds?.disks} />

      {/* Alerts */}
      <AlertsCard savedThresholds={savedConfig?.thresholds} />

      {/* Re-run setup wizard */}
      <RerunWizardCard />
    </div>
  );
}

function DisksCard({ savedDisks }) {
  const { data, isLoading, isError } = useAllDisks();
  const updateConfig = useUpdateConfig();
  const allMounts = (data?.disks ?? []).map((d) => d.mount);

  // When the config has no `thresholds.disks` set, the backend treats this as
  // "monitor everything", mirror that in the UI by defaulting all switches on.
  // Once the user explicitly saves a non-empty list, that list is the source of truth.
  const isUnset = !Array.isArray(savedDisks) || savedDisks.length === 0;
  const initialSelected = isUnset ? allMounts : savedDisks;

  const [selected, setSelected] = useState(initialSelected);
  const [hasSeeded, setHasSeeded] = useState(false);

  // Seed once when the disks list loads. Re-seed if the saved config changes
  // out from under us (e.g., wizard re-run).
  useEffect(() => {
    if (!data) return;
    if (hasSeeded) return;
    const next = isUnset ? (data.disks ?? []).map((d) => d.mount) : savedDisks;
    setSelected(next);
    setHasSeeded(true);
  }, [data, savedDisks, isUnset, hasSeeded]);

  // If saved config changes (e.g. another tab saved), reset the seed flag
  // so the next data refresh re-applies the canonical state.
  useEffect(() => {
    setHasSeeded(false);
  }, [savedDisks]);

  function toggle(mount) {
    setSelected((prev) =>
      prev.includes(mount) ? prev.filter((m) => m !== mount) : [...prev, mount],
    );
  }

  function handleSave() {
    updateConfig.mutate(
      { thresholds: { disks: selected } },
      {
        onSuccess: () => {
          toastManager.add({ type: "success", title: "Disk selection saved" });
        },
        onError: (err) => {
          toastManager.add({
            type: "error",
            title: "Failed to save disks",
            description: err.message,
          });
        },
      },
    );
  }

  // Compare against the canonical state to know if there are unsaved changes
  const canonical = isUnset ? allMounts : savedDisks;
  const isDirty =
    selected.length !== canonical.length ||
    selected.some((m) => !canonical.includes(m));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="size-4" />
          Disks to Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose which mounts appear on the dashboard and feed into health checks.
          When nothing is saved, every detected disk is monitored by default.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading disks…
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">
            Could not load disks. Check that the backend is reachable.
          </p>
        )}

        {!isLoading && !isError && (
          <DiskSelector
            disks={data?.disks ?? []}
            selected={selected}
            onToggle={toggle}
            emptyMessage="No disks detected on the host."
          />
        )}

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={!isDirty || updateConfig.isPending}
            size="sm"
          >
            {updateConfig.isPending ? <Spinner className="size-4" /> : null}
            Save disks
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertsCard({ savedThresholds }) {
  const updateConfig = useUpdateConfig();
  const [diskWarnPct, setDiskWarnPct] = useState(savedThresholds?.disk_warn_pct ?? 85);
  const [diskCritPct, setDiskCritPct] = useState(savedThresholds?.disk_crit_pct ?? 90);
  const [watchdogHours, setWatchdogHours] = useState(
    savedThresholds?.watchdog_threshold_hours ?? 2,
  );

  useEffect(() => {
    if (!savedThresholds) return;
    setDiskWarnPct(savedThresholds.disk_warn_pct ?? 85);
    setDiskCritPct(savedThresholds.disk_crit_pct ?? 90);
    setWatchdogHours(savedThresholds.watchdog_threshold_hours ?? 2);
  }, [savedThresholds]);

  const isDirty =
    diskWarnPct !== (savedThresholds?.disk_warn_pct ?? 85) ||
    diskCritPct !== (savedThresholds?.disk_crit_pct ?? 90) ||
    watchdogHours !== (savedThresholds?.watchdog_threshold_hours ?? 2);

  function handleSave() {
    updateConfig.mutate(
      {
        thresholds: {
          disk_warn_pct: diskWarnPct,
          disk_crit_pct: diskCritPct,
          watchdog_threshold_hours: watchdogHours,
        },
      },
      {
        onSuccess: () => {
          toastManager.add({ type: "success", title: "Thresholds saved" });
        },
        onError: (err) => {
          toastManager.add({
            type: "error",
            title: "Failed to save thresholds",
            description: err.message,
          });
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts &amp; Thresholds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          These thresholds control when health check alerts are triggered. When a disk crosses
          a threshold, any notification rules configured for that event will fire.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="disk-warn">Disk Warning (%)</Label>
            <Input
              id="disk-warn"
              type="number"
              min={50}
              max={99}
              value={diskWarnPct}
              onChange={(e) => setDiskWarnPct(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              System status becomes &quot;degraded&quot; when any disk exceeds this percentage.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="disk-crit">Disk Critical (%)</Label>
            <Input
              id="disk-crit"
              type="number"
              min={50}
              max={99}
              value={diskCritPct}
              onChange={(e) => setDiskCritPct(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              System status becomes &quot;unhealthy&quot; when any disk exceeds this percentage.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="watchdog-hours">Watchdog Stall (hours)</Label>
            <Input
              id="watchdog-hours"
              type="number"
              min={1}
              max={72}
              value={watchdogHours}
              onChange={(e) => setWatchdogHours(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Downloads in the queue longer than this are flagged as stalled.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!isDirty || updateConfig.isPending}
            size="sm"
          >
            {updateConfig.isPending ? <Spinner className="size-4" /> : null}
            Save thresholds
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const EMPTY_AUTH_DRAFT = {
  mode: "none",
  username: "",
  password: "",
  confirmPassword: "",
  proxyHeader: "Remote-User",
};

function AuthCard() {
  const {
    mode: currentMode,
    isWritable,
    storedUsername,
    hasPassword,
    proxyHeader: currentProxyHeader,
  } = useAuth();
  const updateAuth = useUpdateAuthConfig();
  const regenerateKey = useRegenerateApiKey();

  const [draft, setDraft] = useState(EMPTY_AUTH_DRAFT);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [pendingMode, setPendingMode] = useState(null);

  // Seed the form from the auth-status payload (the only source for
  // non-secret auth metadata, /api/config strips the auth block).
  useEffect(() => {
    setDraft({
      mode: currentMode || "none",
      currentMode: currentMode || "none",
      username: storedUsername,
      password: "",
      confirmPassword: "",
      proxyHeader: currentProxyHeader,
    });
  }, [currentMode, storedUsername, currentProxyHeader]);

  const isReadOnly = !isWritable;
  const hasModeChanged = draft.mode !== currentMode;
  const hasBasicChanges =
    draft.mode === "basic" &&
    (draft.username !== storedUsername || draft.password !== "");
  const hasProxyChanges =
    draft.mode === "proxy" && draft.proxyHeader !== currentProxyHeader;

  const canSave =
    !isReadOnly && (hasModeChanged || hasBasicChanges || hasProxyChanges);

  async function handleGenerateKey() {
    try {
      const result = await regenerateKey.mutateAsync();
      if (result?.api_key) {
        setGeneratedKey(result.api_key);
        toastManager.add({
          type: "success",
          title: "API key generated",
          description: "Copy it now, it will not be shown again.",
        });
      }
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to generate key",
        description: err.message,
      });
    }
  }

  function buildBody() {
    if (draft.mode === "basic") {
      return {
        mode: "basic",
        username: draft.username,
        password: draft.password || undefined,
      };
    }
    if (draft.mode === "proxy") {
      return { mode: "proxy", proxy_header: draft.proxyHeader || "Remote-User" };
    }
    return { mode: draft.mode };
  }

  async function handleConfirmedSave() {
    if (draft.mode === "basic") {
      if (!draft.username) {
        toastManager.add({ type: "error", title: "Username is required" });
        return;
      }
      if (!hasPassword && !draft.password) {
        toastManager.add({ type: "error", title: "Set a password to enable basic auth" });
        return;
      }
      if (draft.password && draft.password !== draft.confirmPassword) {
        toastManager.add({ type: "error", title: "Passwords do not match" });
        return;
      }
    }

    try {
      await updateAuth.mutateAsync(buildBody());
      toastManager.add({
        type: "success",
        title: "Authentication updated",
        description:
          draft.mode === "basic" && draft.password
            ? "You may need to log in again with the new password."
            : undefined,
      });
      setDraft((d) => ({ ...d, password: "", confirmPassword: "", currentMode: draft.mode }));
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to update authentication",
        description: err.message,
      });
    }
  }

  // Save click → if mode is changing, route through the confirm dialog;
  // otherwise apply immediately.
  function handleSaveClick() {
    if (hasModeChanged) {
      setPendingMode(draft.mode);
    } else {
      handleConfirmedSave();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldIcon className="size-4" />
          Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Manage how users sign in to Panelarr. Mode changes take effect immediately and
          may require you to re-authenticate.
        </p>

        <AuthSection
          value={draft}
          onChange={setDraft}
          isReadOnly={isReadOnly}
          apiKey={generatedKey}
          onGenerateApiKey={handleGenerateKey}
          isGeneratingApiKey={regenerateKey.isPending}
          showCurrentBadge
        />

        {!isReadOnly && (
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveClick}
              disabled={!canSave || updateAuth.isPending}
              size="sm"
            >
              {updateAuth.isPending ? <Spinner className="size-4" /> : null}
              {hasModeChanged ? "Apply mode change" : "Save changes"}
            </Button>
          </div>
        )}
      </CardContent>

      {/* Confirm mode change */}
      <AlertDialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change authentication mode?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re switching from{" "}
              <strong className="font-medium text-foreground">{currentMode}</strong> to{" "}
              <strong className="font-medium text-foreground">{pendingMode}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 px-6 pb-6 text-sm text-muted-foreground">
            {pendingMode === "none" && (
              <p>
                Anyone who can reach this URL will have full access. Only do this on a
                trusted local network.
              </p>
            )}
            {pendingMode === "basic" && (
              <p>
                After saving, your current session ends and you&apos;ll be redirected to
                the login page. Make sure you&apos;ve entered a password you remember.
              </p>
            )}
            {pendingMode === "proxy" && (
              <p>
                Panelarr will trust the configured header from your reverse proxy. If
                your proxy isn&apos;t actually setting that header, you&apos;ll be
                locked out and will need to fix the proxy or edit{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  panelarr.json
                </code>{" "}
                directly.
              </p>
            )}
            {pendingMode === "apikey" && (
              <p>
                The browser dashboard becomes inaccessible without an{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  X-Api-Key
                </code>{" "}
                header. Use this only for automation or behind a proxy that injects the
                header.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogClose>
            <Button
              onClick={async () => {
                setPendingMode(null);
                await handleConfirmedSave();
              }}
              disabled={updateAuth.isPending}
            >
              {updateAuth.isPending ? <Spinner className="size-4" /> : null}
              Apply change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function RerunWizardCard() {
  const navigate = useNavigate();
  const resetSetup = useSetupReset();

  function handleConfirm() {
    resetSetup.mutate(undefined, {
      onSuccess: () => {
        // Clear cached wizard form state so stale enabledServices /
        // notification drafts can't survive the reset.
        try {
          sessionStorage.removeItem("panelarr_setup_state");
        } catch {
          // ignore, sessionStorage may be unavailable in private mode
        }
        toastManager.add({ type: "info", title: "Setup wizard reset", description: "Redirecting to wizard..." });
        navigate("/setup");
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCwIcon className="size-4" />
          Setup Wizard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Re-run the setup wizard for a clean install. Most changes can be made
          directly on this Settings page without resetting, only use this if you
          want to start over from scratch.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              Re-run Setup Wizard
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-run Setup Wizard?</AlertDialogTitle>
              <AlertDialogDescription>
                This is a destructive action. The items below will be wiped from your config.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 px-6 pb-6 text-sm text-muted-foreground">
              <ul className="ml-5 list-disc space-y-1">
                <li>All configured services (Sonarr, Radarr, Plex, etc.) and their API keys</li>
                <li>All notification channels</li>
                <li>All threshold and disk-monitoring settings</li>
              </ul>
              <p>
                Your <strong className="font-medium text-foreground">authentication mode and credentials are preserved</strong>,
                so you will not be logged out. If you only want to update services or notifications,
                cancel and edit them directly above instead.
              </p>
            </div>
            <AlertDialogFooter>
              <AlertDialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </AlertDialogClose>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={resetSetup.isPending}
              >
                {resetSetup.isPending ? <Spinner className="size-4" /> : null}
                Wipe and Re-run Wizard
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
