import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthSection } from "@/components/auth-section";
import { useSetupAuth, useSetupStatus } from "@/hooks/use-api";
import { useSetupActions, useSetupNav, useSetupState } from "@/hooks/use-setup";
import { toastManager } from "@/components/ui/toast";

export default function SetupAuth() {
  const { data: status } = useSetupStatus();
  const { auth } = useSetupState();
  const { setAuth } = useSetupActions();
  const { goBack, goNext } = useSetupNav("/setup/auth");
  const setupAuth = useSetupAuth();
  const [generatedKey, setGeneratedKey] = useState(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const isReadOnly = status?.auth_writable === false;
  const detectedProxy = status?.detected_proxy ?? null;

  // When the backend detects a known reverse-proxy auth header on the wizard's
  // own request, pre-select Reverse Proxy mode and seed the header field , 
  // unless the user has already chosen something else this session.
  const seededProxyRef = useRef(false);
  useEffect(() => {
    if (seededProxyRef.current) return;
    if (!detectedProxy) return;
    if (isReadOnly) return;
    if (auth.mode && auth.mode !== "none") return;
    seededProxyRef.current = true;
    setAuth({ mode: "proxy", proxyHeader: detectedProxy.header });
  }, [detectedProxy, isReadOnly, auth.mode, setAuth]);

  async function handleGenerateKey() {
    try {
      const result = await setupAuth.mutateAsync({ mode: "apikey" });
      if (result?.api_key) {
        setGeneratedKey(result.api_key);
        setAuth({ mode: "apikey" });
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

  function handleAuthChange(next) {
    // Reset the generated apikey if the user switches modes away from apikey
    if (next.mode !== "apikey" && generatedKey) {
      setGeneratedKey(null);
    }
    setAuth(next);
  }

  async function handleNext() {
    if (isReadOnly) {
      goNext();
      return;
    }

    setIsAdvancing(true);
    try {
      if (auth.mode === "basic") {
        if (!auth.username || !auth.password) {
          toastManager.add({ type: "error", title: "Username and password are required" });
          return;
        }
        if (auth.password !== auth.confirmPassword) {
          toastManager.add({ type: "error", title: "Passwords do not match" });
          return;
        }
        await setupAuth.mutateAsync({
          mode: "basic",
          username: auth.username,
          password: auth.password,
        });
      } else if (auth.mode === "proxy") {
        await setupAuth.mutateAsync({
          mode: "proxy",
          proxy_header: auth.proxyHeader || "Remote-User",
        });
      } else if (auth.mode === "none") {
        await setupAuth.mutateAsync({ mode: "none" });
      } else if (auth.mode === "apikey") {
        if (!generatedKey) {
          toastManager.add({ type: "error", title: "Generate an API key first" });
          return;
        }
      }
      goNext();
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to save auth settings",
        description: err.message,
      });
    } finally {
      setIsAdvancing(false);
    }
  }

  const isPending = setupAuth.isPending || isAdvancing;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Choose how users authenticate to access Panelarr.
        </p>
      </div>

      <AuthSection
        value={auth}
        onChange={handleAuthChange}
        isReadOnly={isReadOnly}
        detectedProxy={detectedProxy}
        apiKey={generatedKey}
        onGenerateApiKey={handleGenerateKey}
        isGeneratingApiKey={setupAuth.isPending}
      />

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={goBack}>
          Back
        </Button>
        <Button onClick={handleNext} disabled={isPending}>
          {isPending ? <Spinner className="size-4" /> : null}
          Next
        </Button>
      </div>
    </div>
  );
}
