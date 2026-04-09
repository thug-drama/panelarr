import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "panelarr-theme";
const MODES = ["light", "dark", "system"];

const ThemeContext = createContext(null);

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode) {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return MODES.includes(stored) ? stored : "system";
    } catch {
      return "system";
    }
  });

  const setMode = useCallback((newMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // localStorage may be unavailable
    }
    applyTheme(newMode);
  }, []);

  const cycleMode = useCallback(() => {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  }, [mode, setMode]);

  // Apply theme on mount and when mode changes
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // Listen for OS preference changes when in system mode
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const resolved = mode === "system" ? getSystemTheme() : mode;

  const value = useMemo(
    () => ({ mode, resolved, setMode, cycleMode }),
    [mode, resolved, setMode, cycleMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
