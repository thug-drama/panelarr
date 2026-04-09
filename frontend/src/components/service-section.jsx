import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, InfoIcon, XCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SecretInput } from "@/components/secret-input";

function FieldHelp({ children }) {
  // Render URLs in help text as clickable links so users can jump straight
  // to the relevant docs (e.g. Plex token guide).
  const urlMatch = typeof children === "string" ? children.match(/https?:\/\/\S+/) : null;
  if (!urlMatch) return <span>{children}</span>;
  const [before, after] = children.split(urlMatch[0]);
  return (
    <span>
      {before}
      <a
        href={urlMatch[0]}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {urlMatch[0]}
      </a>
      {after}
    </span>
  );
}

/**
 * ServiceSection renders form fields for a single service plus a Test button.
 *
 * Props:
 *   title        {string}   - Display name of the service
 *   description  {string?}  - Optional subtitle
 *   service      {string}   - Service slug (e.g. "sonarr")
 *   fields       {Array}    - [{ key, label, placeholder }]
 *   secretFields {string[]} - Field keys that should be masked
 *   config       {object}   - Current field values
 *   setConfig    {fn}       - (newConfig) => void
 *   testService  {object}   - useMutation result for the test action
 *   autoTest     {boolean}  - Run a silent test on mount if URL is pre-filled
 */
export function ServiceSection({ title, description, fields, config, setConfig, service, testService, secretFields, autoTest }) {
  const [testResult, setTestResult] = useState(null);
  const isTesting = testService.isPending && testService.variables?.service === service;
  const hasAutoTested = useRef(false);

  async function runTest(showToast = false) {
    setTestResult(null);
    try {
      const result = await testService.mutateAsync({ service, config });
      setTestResult(result);
      if (showToast) {
        toastManager.add({
          type: result.ok ? "success" : "error",
          title: `${title}: ${result.ok ? "Connected" : "Failed"}`,
          description: result.message,
        });
      }
    } catch {
      setTestResult({ ok: false, message: "Test failed" });
    }
  }

  const initialUrl = useRef(config?.url);
  useEffect(() => {
    const url = initialUrl.current;
    if (autoTest && url && url.startsWith("http") && !hasAutoTested.current) {
      hasAutoTested.current = true;
      testService.mutateAsync({ service, config: { ...config, url } }).then(
        (result) => setTestResult(result),
        () => setTestResult({ ok: false, message: "Test failed" }),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on mount
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {testResult && (
            testResult.ok ? (
              <CheckCircleIcon className="size-4 text-green-500" />
            ) : (
              <span className="flex items-center gap-1" title={testResult.message}>
                <XCircleIcon className="size-4 text-destructive" />
                <span className="hidden sm:inline text-xs text-destructive max-w-32 truncate">
                  {testResult.message}
                </span>
              </span>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => runTest(true)}
            disabled={isTesting}
          >
            {isTesting ? <Spinner className="size-4" /> : "Test"}
          </Button>
        </div>
      </div>
      <div className={cn(
        "grid grid-cols-1 gap-3",
        fields.length === 2 && "sm:grid-cols-2",
        fields.length >= 3 && "sm:grid-cols-3",
      )}>
        {fields.map((field) => (
          <div key={field.key}>
            <div className="mb-1 flex items-center gap-1.5">
              <Label htmlFor={`${service}-${field.key}`}>
                {field.label}
              </Label>
              {field.helpText && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Help for ${field.label}`}
                        className="inline-flex items-center justify-center rounded-sm text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
                      />
                    }
                  >
                    <InfoIcon className="size-3.5" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-xs px-2.5 py-1.5 text-xs">
                    <FieldHelp>{field.helpText}</FieldHelp>
                  </TooltipPopup>
                </Tooltip>
              )}
            </div>
            {secretFields?.includes(field.key) ? (
              <SecretInput
                id={`${service}-${field.key}`}
                value={config[field.key] || ""}
                onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                placeholder={field.placeholder}
              />
            ) : (
              <Input
                id={`${service}-${field.key}`}
                value={config[field.key] || ""}
                onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                placeholder={field.placeholder}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
