"use client";
import { useCallback, useSyncExternalStore } from "react";

const BREAKPOINTS = {
  "2xl": 1536,
  "3xl": 1600,
  "4xl": 2000,
  lg: 1024,
  md: 800,
  sm: 640,
  xl: 1280
};

function resolveMin(value) {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(min-width: ${px}px)`;
}

function resolveMax(value) {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(max-width: ${px - 1}px)`;
}

function parseQuery(query) {
  if (typeof query !== "string") {
    const parts = [];
    if (query.min != null) parts.push(resolveMin(query.min));
    if (query.max != null) parts.push(resolveMax(query.max));
    if (query.pointer === "coarse") parts.push("(pointer: coarse)");
    if (query.pointer === "fine") parts.push("(pointer: fine)");
    if (parts.length === 0) return "(min-width: 0px)";
    return parts.join(" and ");
  }

  if (query.startsWith("(")) return query;

  const parts = [];
  for (const segment of query.split(":")) {
    if (segment.startsWith("max-")) {
      const bp = segment.slice(4);
      if (bp in BREAKPOINTS) parts.push(resolveMax(bp));
    } else if (segment in BREAKPOINTS) {
      parts.push(resolveMin(segment));
    }
  }

  return parts.length > 0 ? parts.join(" and ") : query;
}

function getServerSnapshot() {
  return false;
}

export function useMediaQuery(query) {
  const mediaQuery = parseQuery(query);

  const subscribe = useCallback((callback) => {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia(mediaQuery);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  }, [mediaQuery]);

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
