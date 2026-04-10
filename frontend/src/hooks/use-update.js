import { useCallback, useSyncExternalStore } from "react";

import { useSelfUpdate } from "@/hooks/use-api";

let isUpdating = false;
const listeners = new Set();

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return isUpdating;
}

function setUpdating(value) {
  isUpdating = value;
  listeners.forEach((cb) => cb());
}

function pollUntilHealthy() {
  const poll = setInterval(async () => {
    try {
      const resp = await fetch("/api/system/health");
      if (resp.ok) {
        clearInterval(poll);
        window.location.reload();
      }
    } catch {
      // Still restarting
    }
  }, 2000);
  setTimeout(() => {
    clearInterval(poll);
    setUpdating(false);
  }, 120_000);
}

export function useUpdate() {
  const selfUpdate = useSelfUpdate();
  const updating = useSyncExternalStore(subscribe, getSnapshot);

  const triggerUpdate = useCallback(async () => {
    if (isUpdating) return;
    setUpdating(true);
    try {
      await selfUpdate.mutateAsync();
    } catch {
      // Container may die before responding
    }
    pollUntilHealthy();
  }, [selfUpdate]);

  return { isUpdating: updating, triggerUpdate };
}
