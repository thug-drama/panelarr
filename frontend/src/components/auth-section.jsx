import { useState } from "react";
import {
  CopyIcon,
  KeyIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { SecretInput } from "@/components/secret-input";

const AUTH_MODES = [
  {
    value: "none",
    label: "None",
    description: "No authentication, anyone can access the dashboard",
  },
  {
    value: "basic",
    label: "Username & Password",
    description: "Built-in login with JWT session cookies",
  },
  {
    value: "proxy",
    label: "Reverse Proxy",
    description: "Trust auth from Traefik, Caddy, or similar (e.g. Authelia)",
  },
  {
    value: "apikey",
    label: "API Key",
    description: "Require an X-Api-Key header on all requests",
  },
];

/**
 * Shared authentication form used by both the setup wizard and the Settings
 * page.
 *
 * The component is fully controlled, the parent owns the form state via
 * `value` / `onChange` and supplies the apikey result via `apiKey`. Behaviour
 * differences between wizard (initial setup) and settings (post-setup mutate)
 * are expressed through optional props rather than separate components, so
 * both surfaces stay visually identical.
 */
export function AuthSection({
  value,
  onChange,
  isReadOnly = false,
  detectedProxy = null,
  apiKey = null,
  onGenerateApiKey,
  isGeneratingApiKey = false,
  showCurrentBadge = false,
}) {
  const [hasCopied, setHasCopied] = useState(false);

  function handleModeChange(mode) {
    onChange({ ...value, mode });
  }

  function handleField(key, fieldValue) {
    onChange({ ...value, [key]: fieldValue });
  }

  async function handleCopyKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setHasCopied(true);
      toastManager.add({ type: "success", title: "Copied to clipboard" });
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toastManager.add({ type: "error", title: "Copy failed" });
    }
  }

  return (
    <div className="space-y-6">
      {isReadOnly && (
        <Alert variant="info">
          <ShieldOffIcon className="size-4" />
          <AlertTitle>Authentication is managed by environment variables</AlertTitle>
          <AlertDescription>
            <p>
              Auth mode and credentials are pinned via environment variables and cannot
              be changed here. Remove <code className="rounded bg-info/10 px-1 py-0.5 font-mono text-xs">AUTH_USERNAME</code> /{" "}
              <code className="rounded bg-info/10 px-1 py-0.5 font-mono text-xs">AUTH_PASSWORD</code> from your environment to manage auth in-app.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {detectedProxy && !isReadOnly && (
        <Alert variant="success">
          <ShieldCheckIcon className="size-4" />
          <AlertTitle>
            We detected you&apos;re behind {detectedProxy.provider}
          </AlertTitle>
          <AlertDescription>
            <p>
              This request arrived with a{" "}
              <code className="rounded bg-success/10 px-1 py-0.5 font-mono text-xs">
                {detectedProxy.header}
              </code>{" "}
              header (value:{" "}
              <code className="rounded bg-success/10 px-1 py-0.5 font-mono text-xs">
                {detectedProxy.value}
              </code>
              ), which means your reverse proxy is already authenticating users.{" "}
              <strong className="font-medium text-foreground">Reverse Proxy</strong>{" "}
              mode is recommended so users aren&apos;t prompted to log in twice.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Mode selector */}
      <div className="space-y-2">
        <Label>Authentication mode</Label>
        <div className="grid gap-2">
          {AUTH_MODES.map((mode) => (
            <label
              key={mode.value}
              className={[
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                value.mode === mode.value
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/50 hover:bg-muted/50",
                isReadOnly ? "pointer-events-none opacity-60" : "",
              ].join(" ")}
            >
              <input
                type="radio"
                name="auth-mode"
                value={mode.value}
                checked={value.mode === mode.value}
                onChange={() => handleModeChange(mode.value)}
                className="mt-0.5"
                disabled={isReadOnly}
              />
              <div className="flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {mode.label}
                  {showCurrentBadge && value.currentMode === mode.value && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      Current
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{mode.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* None warning */}
      {value.mode === "none" && !isReadOnly && (
        <Alert variant="warning">
          <ShieldOffIcon className="size-4" />
          <AlertTitle>No authentication</AlertTitle>
          <AlertDescription>
            Anyone who can reach this URL will have full access. Only use this on a
            trusted local network.
          </AlertDescription>
        </Alert>
      )}

      {/* Basic auth fields */}
      {value.mode === "basic" && !isReadOnly && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="auth-username" className="mb-1">
              Username
            </Label>
            <Input
              id="auth-username"
              value={value.username ?? ""}
              onChange={(e) => handleField("username", e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </div>
          <div>
            <Label htmlFor="auth-password" className="mb-1">
              Password
            </Label>
            <SecretInput
              id="auth-password"
              value={value.password ?? ""}
              onChange={(e) => handleField("password", e.target.value)}
              placeholder="Enter a strong password"
            />
          </div>
          <div>
            <Label htmlFor="auth-confirm" className="mb-1">
              Confirm Password
            </Label>
            <SecretInput
              id="auth-confirm"
              value={value.confirmPassword ?? ""}
              onChange={(e) => handleField("confirmPassword", e.target.value)}
              placeholder="Repeat password"
            />
          </div>
        </div>
      )}

      {/* Proxy header */}
      {value.mode === "proxy" && !isReadOnly && (
        <div>
          <Label htmlFor="proxy-header" className="mb-1">
            Auth header name
          </Label>
          <Input
            id="proxy-header"
            value={value.proxyHeader ?? ""}
            onChange={(e) => handleField("proxyHeader", e.target.value)}
            placeholder="Remote-User"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Authelia: Remote-User · Authentik: X-authentik-username · oauth2-proxy:
            X-Auth-Request-User
          </p>
        </div>
      )}

      {/* API key generation */}
      {value.mode === "apikey" && !isReadOnly && (
        <div className="space-y-3">
          {!apiKey ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Click Generate to create a secure API key. The key will only be shown
                once.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onGenerateApiKey}
                disabled={isGeneratingApiKey}
                type="button"
              >
                {isGeneratingApiKey ? (
                  <Spinner className="size-4" />
                ) : (
                  <KeyIcon className="size-4" />
                )}
                Generate API Key
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Alert variant="warning">
                <AlertTitle>Copy your API key now</AlertTitle>
                <AlertDescription>
                  This key will not be shown again. Store it securely.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs">
                  {apiKey}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={handleCopyKey}
                  title={hasCopied ? "Copied" : "Copy"}
                >
                  <CopyIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
