import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { useNavigate } from "react-router-dom";

const WIZARD_STEPS = [
  "/setup/welcome",
  "/setup/system-check",
  "/setup/auth",
  "/setup/discover",
  "/setup/services",
  "/setup/notifications",
  "/setup/thresholds",
  "/setup/done",
];

const STORAGE_KEY = "panelarr_setup_state";

const initialState = {
  auth: { mode: "none", username: "", password: "", confirmPassword: "", proxyHeader: "Remote-User" },
  services: {},
  enabledServices: [],
  notification: null,
  thresholds: { disk_warn_pct: 85, disk_crit_pct: 90, watchdog_threshold_hours: 2 },
  selectedDisks: [],
  discoverSeeded: false,
};

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw);
    return { ...initialState, ...parsed };
  } catch {
    return initialState;
  }
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_AUTH":
      return { ...state, auth: { ...state.auth, ...action.payload } };
    case "SET_SERVICE":
      return {
        ...state,
        services: { ...state.services, [action.name]: { ...state.services[action.name], ...action.payload } },
      };
    case "SET_SERVICES":
      return { ...state, services: action.payload };
    case "SET_ENABLED_SERVICES":
      return { ...state, enabledServices: action.payload };
    case "TOGGLE_SERVICE": {
      const enabled = state.enabledServices.includes(action.name)
        ? state.enabledServices.filter((s) => s !== action.name)
        : [...state.enabledServices, action.name];
      return { ...state, enabledServices: enabled };
    }
    case "SET_NOTIFICATION":
      return { ...state, notification: action.payload };
    case "SET_THRESHOLDS":
      return { ...state, thresholds: { ...state.thresholds, ...action.payload } };
    case "SET_SELECTED_DISKS":
      return { ...state, selectedDisks: action.payload };
    case "TOGGLE_DISK": {
      const next = state.selectedDisks.includes(action.mount)
        ? state.selectedDisks.filter((m) => m !== action.mount)
        : [...state.selectedDisks, action.mount];
      return { ...state, selectedDisks: next };
    }
    case "MARK_DISCOVER_SEEDED":
      return { ...state, discoverSeeded: true };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

const SetupStateContext = createContext(null);
const SetupActionsContext = createContext(null);
const SetupNavContext = createContext(null);

export function SetupProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage);
  const navigate = useNavigate();

  // Persist state to sessionStorage on every change
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors (private browsing, etc.)
    }
  }, [state]);

  const actions = useMemo(() => ({
    setAuth: (payload) => dispatch({ type: "SET_AUTH", payload }),
    setService: (name, payload) => dispatch({ type: "SET_SERVICE", name, payload }),
    setServices: (payload) => dispatch({ type: "SET_SERVICES", payload }),
    setEnabledServices: (payload) => dispatch({ type: "SET_ENABLED_SERVICES", payload }),
    toggleService: (name) => dispatch({ type: "TOGGLE_SERVICE", name }),
    setNotification: (payload) => dispatch({ type: "SET_NOTIFICATION", payload }),
    setThresholds: (payload) => dispatch({ type: "SET_THRESHOLDS", payload }),
    setSelectedDisks: (payload) => dispatch({ type: "SET_SELECTED_DISKS", payload }),
    toggleDisk: (mount) => dispatch({ type: "TOGGLE_DISK", mount }),
    markDiscoverSeeded: () => dispatch({ type: "MARK_DISCOVER_SEEDED" }),
    reset: () => {
      dispatch({ type: "RESET" });
      sessionStorage.removeItem(STORAGE_KEY);
    },
  }), []);

  const navActions = useCallback((currentPath) => {
    const currentIndex = WIZARD_STEPS.indexOf(currentPath);
    const canGoBack = currentIndex > 0;
    const canGoNext = currentIndex < WIZARD_STEPS.length - 1;

    return {
      currentStep: currentIndex + 1,
      totalSteps: WIZARD_STEPS.length,
      stepPath: currentPath,
      canGoBack,
      canGoNext,
      goBack: () => {
        if (canGoBack) navigate(WIZARD_STEPS[currentIndex - 1]);
      },
      goNext: () => {
        if (canGoNext) navigate(WIZARD_STEPS[currentIndex + 1]);
      },
      goTo: (path) => navigate(path),
    };
  }, [navigate]);

  return (
    <SetupStateContext.Provider value={state}>
      <SetupActionsContext.Provider value={actions}>
        <SetupNavContext.Provider value={navActions}>
          {children}
        </SetupNavContext.Provider>
      </SetupActionsContext.Provider>
    </SetupStateContext.Provider>
  );
}

export function useSetupState() {
  const ctx = useContext(SetupStateContext);
  if (!ctx) throw new Error("useSetupState must be used within <SetupProvider>");
  return ctx;
}

export function useSetupActions() {
  const ctx = useContext(SetupActionsContext);
  if (!ctx) throw new Error("useSetupActions must be used within <SetupProvider>");
  return ctx;
}

export function useSetupNav(currentPath) {
  const navFactory = useContext(SetupNavContext);
  if (!navFactory) throw new Error("useSetupNav must be used within <SetupProvider>");
  return navFactory(currentPath);
}

export { WIZARD_STEPS };
