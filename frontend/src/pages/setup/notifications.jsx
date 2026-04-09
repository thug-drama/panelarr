import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { useSetupNotifications, useSetupTestNotification } from "@/hooks/use-api";
import { useSetupActions, useSetupNav, useSetupState } from "@/hooks/use-setup";

// Channel definitions, each tab represents one notification channel type.
// Email is intentionally excluded; it will be added later with deliverability tooling.
const CHANNELS = [
  {
    type: "discord",
    label: "Discord",
    defaultName: "Discord",
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
        helpText: "Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.",
        type: "url",
      },
    ],
  },
  {
    type: "slack",
    label: "Slack",
    defaultName: "Slack",
    fields: [
      {
        key: "webhook_url",
        label: "Incoming Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
        helpText: "Slack App → Incoming Webhooks → Add New Webhook to Workspace → Copy URL.",
        type: "url",
      },
    ],
  },
  {
    type: "telegram",
    label: "Telegram",
    defaultName: "Telegram",
    fields: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        helpText: "Create a bot via @BotFather on Telegram and copy the token it gives you.",
      },
      {
        key: "chat_id",
        label: "Chat ID",
        placeholder: "-1001234567890 or 12345678",
        helpText: "Send any message to your bot, then visit https://api.telegram.org/bot<token>/getUpdates to find your chat id.",
      },
    ],
  },
  {
    type: "webhook",
    label: "Webhook",
    defaultName: "Generic Webhook",
    fields: [
      {
        key: "url",
        label: "Webhook URL",
        placeholder: "https://example.com/hooks/panelarr",
        helpText: "Any HTTPS endpoint that accepts a JSON POST body with title and message fields.",
        type: "url",
      },
    ],
  },
];

function isChannelComplete(channel) {
  if (!channel) return false;
  const def = CHANNELS.find((c) => c.type === channel.type);
  if (!def) return false;
  return def.fields.every((f) => (channel.config?.[f.key] ?? "").toString().trim() !== "");
}

export default function SetupNotifications() {
  const { notification } = useSetupState();
  const { setNotification } = useSetupActions();
  const { goBack, goNext } = useSetupNav("/setup/notifications");
  const setupNotifications = useSetupNotifications();
  const testNotification = useSetupTestNotification();
  const [activeTab, setActiveTab] = useState(notification?.type ?? "discord");
  const [testResult, setTestResult] = useState(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  // For each tab, store its in-progress config locally so switching tabs
  // doesn't lose data, but only the active tab is persisted into wizard state.
  const [drafts, setDrafts] = useState(() => {
    const initial = {};
    for (const c of CHANNELS) {
      if (notification?.type === c.type) {
        initial[c.type] = { ...(notification.config ?? {}) };
      } else {
        initial[c.type] = {};
      }
    }
    return initial;
  });

  function updateField(channelType, fieldKey, value) {
    setDrafts((prev) => ({
      ...prev,
      [channelType]: { ...prev[channelType], [fieldKey]: value },
    }));
    setTestResult(null);

    // Persist into wizard state if this is the active tab
    if (channelType === activeTab) {
      const def = CHANNELS.find((c) => c.type === channelType);
      const nextConfig = { ...drafts[channelType], [fieldKey]: value };
      const complete = def.fields.every((f) => (nextConfig[f.key] ?? "").toString().trim() !== "");
      setNotification({
        type: channelType,
        name: def.defaultName,
        config: nextConfig,
        enabled: complete,
      });
    }
  }

  function handleTabChange(value) {
    setActiveTab(value);
    setTestResult(null);
    const def = CHANNELS.find((c) => c.type === value);
    const cfg = drafts[value] ?? {};
    const complete = def.fields.every((f) => (cfg[f.key] ?? "").toString().trim() !== "");
    setNotification({
      type: value,
      name: def.defaultName,
      config: cfg,
      enabled: complete,
    });
  }

  async function handleTest() {
    const def = CHANNELS.find((c) => c.type === activeTab);
    const cfg = drafts[activeTab] ?? {};
    if (!def.fields.every((f) => (cfg[f.key] ?? "").toString().trim() !== "")) return;

    setTestResult(null);
    try {
      const result = await testNotification.mutateAsync({
        channel: { type: activeTab, name: def.defaultName, config: cfg, enabled: true },
      });
      setTestResult(result);
      toastManager.add({
        type: result.ok ? "success" : "error",
        title: result.ok ? `${def.label} test sent` : `${def.label} test failed`,
        description: result.message,
      });
    } catch (err) {
      const result = { ok: false, message: err.message };
      setTestResult(result);
    }
  }

  async function handleNext() {
    setIsAdvancing(true);
    try {
      const def = CHANNELS.find((c) => c.type === activeTab);
      const cfg = drafts[activeTab] ?? {};
      const complete = def.fields.every((f) => (cfg[f.key] ?? "").toString().trim() !== "");
      if (complete) {
        await setupNotifications.mutateAsync({
          channel: { type: activeTab, name: def.defaultName, config: cfg, enabled: true },
        });
      }
      goNext();
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to save notification",
        description: err.message,
      });
    } finally {
      setIsAdvancing(false);
    }
  }

  function handleSkip() {
    setNotification(null);
    goNext();
  }

  const isPending = setupNotifications.isPending || isAdvancing;
  const activeDef = CHANNELS.find((c) => c.type === activeTab);
  const activeCfg = drafts[activeTab] ?? {};
  const activeComplete = isChannelComplete({ type: activeTab, config: activeCfg });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Optionally connect a notification channel to receive health alerts.
          You can add more channels (or change them) in Settings later. This step can be skipped.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          {CHANNELS.map((c) => (
            <TabsTrigger key={c.type} value={c.type}>
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {CHANNELS.map((c) => (
          <TabsContent key={c.type} value={c.type} className="space-y-4 pt-4">
            {c.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`${c.type}-${field.key}`}>{field.label}</Label>
                <Input
                  id={`${c.type}-${field.key}`}
                  type={field.type ?? "text"}
                  value={drafts[c.type]?.[field.key] ?? ""}
                  onChange={(e) => updateField(c.type, field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
                {field.helpText && (
                  <p className="text-xs text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={!activeComplete || testNotification.isPending}
              >
                {testNotification.isPending ? <Spinner className="size-4" /> : "Send test"}
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {testResult && (
        <Alert variant={testResult.ok ? "success" : "error"}>
          <AlertTitle>{testResult.ok ? "Test sent" : "Test failed"}</AlertTitle>
          <AlertDescription>{testResult.message}</AlertDescription>
        </Alert>
      )}

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

      <p className="text-center text-xs text-muted-foreground">
        Email notifications are coming in a future release.
      </p>
    </div>
  );
}
