import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toastManager } from "@/components/ui/toast";

function showToast(type, title, description) {
  toastManager.add({ type, title, description });
}


export function useContainers() {
  return useQuery({
    queryKey: ["containers"],
    queryFn: () => apiFetch("/containers"),
  });
}

export function useContainerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }) =>
      apiFetch(`/containers/${name}/${action}`, { method: "POST" }),
    onSuccess: (_data, { name, action }) => {
      showToast("success", `Container ${action === "stop" ? "stopped" : action + "ed"}`, name);
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container", name] });
    },
    onError: (err, { name, action }) => {
      showToast("error", `Failed to ${action} ${name}`, err.message);
    },
  });
}

export function usePullContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name) =>
      apiFetch(`/containers/${name}/update`, { method: "POST" }),
    onSuccess: (data, name) => {
      showToast(
        data.status === "ok" ? "success" : "warning",
        `Update: ${name}`,
        data.message,
      );
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container-updates"] });
    },
    onError: (err, name) => {
      showToast("error", `Failed to update ${name}`, err.message);
    },
  });
}

export function useContainerUpdates() {
  return useQuery({
    queryKey: ["container-updates"],
    queryFn: () => apiFetch("/containers/check-updates"),
    refetchInterval: 300_000, // 5 minutes, registry checks are slow
    staleTime: 300_000,
  });
}


export function useDownloads() {
  return useQuery({
    queryKey: ["downloads"],
    queryFn: () => apiFetch("/downloads/queue"),
  });
}

export function useDownloadStats() {
  return useQuery({
    queryKey: ["download-stats"],
    queryFn: () => apiFetch("/downloads/stats"),
  });
}

export function useDeleteDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, id }) =>
      apiFetch(`/downloads/queue/${source}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      showToast("success", "Removed from queue");
      qc.invalidateQueries({ queryKey: ["downloads"] });
      qc.invalidateQueries({ queryKey: ["download-stats"] });
    },
    onError: (err) => showToast("error", "Failed to remove", err.message),
  });
}

export function useBlocklistDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, id }) =>
      apiFetch(`/downloads/queue/${source}/${id}/blocklist`, { method: "POST" }),
    onSuccess: () => {
      showToast("success", "Blocklisted and searching for new release");
      qc.invalidateQueries({ queryKey: ["downloads"] });
      qc.invalidateQueries({ queryKey: ["download-stats"] });
    },
    onError: (err) => showToast("error", "Failed to blocklist", err.message),
  });
}

export function useBlocklistWarnings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/downloads/queue/blocklist-all-warnings", { method: "POST" }),
    onSuccess: (data) => {
      showToast("success", `Blocklisted ${data.blocklisted} items`);
      qc.invalidateQueries({ queryKey: ["downloads"] });
      qc.invalidateQueries({ queryKey: ["download-stats"] });
    },
    onError: (err) => showToast("error", "Failed to blocklist warnings", err.message),
  });
}

export function useDownloadHistory() {
  return useQuery({
    queryKey: ["download-history"],
    queryFn: () => apiFetch("/downloads/history"),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useActiveTasks() {
  return useQuery({
    queryKey: ["active-tasks"],
    queryFn: () => apiFetch("/downloads/tasks"),
    refetchInterval: 10_000,
  });
}

export function useImportScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source) =>
      apiFetch(`/downloads/import-scan/${source}`, { method: "POST" }),
    onSuccess: (data) => {
      showToast(
        data.ok ? "success" : "error",
        data.ok ? "Import scan triggered" : "Import scan failed",
        data.message,
      );
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
    onError: (err) => showToast("error", "Import scan failed", err.message),
  });
}

export function useLibraryStats() {
  return useQuery({
    queryKey: ["library-stats"],
    queryFn: () => apiFetch("/downloads/library-stats"),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}


export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: () => apiFetch("/system/health"),
  });
}

export function useDisks() {
  // Fast disk-only endpoint, does NOT touch Docker, so it's safe to refetch
  // aggressively and ideal for the dashboard's disk widget. Decoupled from
  // /system/health (which blocks on list_containers) so disk-selection
  // changes show up immediately after a Settings save.
  return useQuery({
    queryKey: ["disks"],
    queryFn: () => apiFetch("/system/disk"),
    staleTime: 15_000,
  });
}

export function useSystemInfo() {
  return useQuery({
    queryKey: ["system-info"],
    queryFn: () => apiFetch("/system/info"),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
}

export function useAllDisks() {
  return useQuery({
    queryKey: ["all-disks"],
    queryFn: () => apiFetch("/system/disks/all"),
    refetchInterval: false,
    staleTime: 30_000,
  });
}


export function useCalendar({
  start,
  end,
  kind = "all",
  includeUnmonitored = true,
  includeSpecials = false,
  includeDownloaded = true,
} = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (kind) params.set("kind", kind);
  params.set("include_unmonitored", includeUnmonitored ? "true" : "false");
  params.set("include_specials", includeSpecials ? "true" : "false");
  params.set("include_downloaded", includeDownloaded ? "true" : "false");
  const qs = params.toString();
  return useQuery({
    queryKey: [
      "calendar",
      { start, end, kind, includeUnmonitored, includeSpecials, includeDownloaded },
    ],
    queryFn: () => apiFetch(`/calendar${qs ? `?${qs}` : ""}`),
    staleTime: 60_000,
    refetchInterval: 120_000,
    keepPreviousData: true,
  });
}


export function useMovies() {
  return useQuery({
    queryKey: ["movies"],
    queryFn: () => apiFetch("/media/movies"),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

export function useShows() {
  return useQuery({
    queryKey: ["shows"],
    queryFn: () => apiFetch("/media/shows"),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

export function useMovieDetail(id) {
  return useQuery({
    queryKey: ["movie-detail", id],
    queryFn: () => apiFetch(`/media/movies/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useShowDetail(id) {
  return useQuery({
    queryKey: ["show-detail", id],
    queryFn: () => apiFetch(`/media/shows/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useMovieQualityProfiles() {
  return useQuery({
    queryKey: ["movie-quality-profiles"],
    queryFn: () => apiFetch("/media/movies/quality-profiles"),
    staleTime: 300_000,
    refetchInterval: false,
  });
}

export function useShowQualityProfiles() {
  return useQuery({
    queryKey: ["show-quality-profiles"],
    queryFn: () => apiFetch("/media/shows/quality-profiles"),
    staleTime: 300_000,
    refetchInterval: false,
  });
}

export function useMovieSearch(query) {
  return useQuery({
    queryKey: ["movie-search", query],
    queryFn: () => apiFetch(`/media/movies/search?q=${encodeURIComponent(query)}`),
    enabled: query?.length >= 2,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

export function useAddMovie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiFetch("/media/movies/add", { method: "POST", body: data }),
    onSuccess: (result) => {
      if (result.ok) {
        showToast("success", "Movie added", result.message);
        qc.invalidateQueries({ queryKey: ["movies"] });
        qc.invalidateQueries({ queryKey: ["movie-search"] });
      } else {
        showToast("error", "Failed to add movie", result.message);
      }
    },
    onError: (err) => showToast("error", "Failed to add", err.message),
  });
}

export function useMovieSearchAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (movieId) => apiFetch(`/media/movies/${movieId}/search`, { method: "POST" }),
    onSuccess: (result) => {
      showToast(result.ok ? "success" : "error", result.ok ? "Search started" : "Search failed", result.message);
      qc.invalidateQueries({ queryKey: ["active-tasks"] });
    },
    onError: (err) => showToast("error", "Search failed", err.message),
  });
}

export function useSearchMissing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (showId) => apiFetch(`/media/shows/${showId}/search-missing`, { method: "POST" }),
    onSuccess: (result) => {
      showToast(result.ok ? "success" : "error", result.ok ? "Search started" : "Search failed", result.message);
      qc.invalidateQueries({ queryKey: ["active-tasks"] });
    },
    onError: (err) => showToast("error", "Search failed", err.message),
  });
}

export function useSeasonSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ showId, seasonNumber }) =>
      apiFetch(`/media/shows/${showId}/search-season/${seasonNumber}`, { method: "POST" }),
    onSuccess: (result) => {
      showToast(result.ok ? "success" : "error", result.ok ? "Search started" : "Search failed", result.message);
      qc.invalidateQueries({ queryKey: ["active-tasks"] });
    },
    onError: (err) => showToast("error", "Search failed", err.message),
  });
}

export function useEpisodeSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (episodeIds) =>
      apiFetch("/media/shows/search-episodes", {
        method: "POST",
        body: { episodeIds },
      }),
    onSuccess: (result) => {
      showToast(result.ok ? "success" : "error", result.ok ? "Search started" : "Search failed", result.message);
      qc.invalidateQueries({ queryKey: ["active-tasks"] });
    },
    onError: (err) => showToast("error", "Search failed", err.message),
  });
}

export function useShowSearch(query) {
  return useQuery({
    queryKey: ["show-search", query],
    queryFn: () => apiFetch(`/media/shows/search?q=${encodeURIComponent(query)}`),
    enabled: query?.length >= 2,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

export function useAddShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiFetch("/media/shows/add", { method: "POST", body: data }),
    onSuccess: (result) => {
      if (result.ok) {
        showToast("success", "Show added", result.message);
        qc.invalidateQueries({ queryKey: ["shows"] });
        qc.invalidateQueries({ queryKey: ["show-search"] });
      } else {
        showToast("error", "Failed to add show", result.message);
      }
    },
    onError: (err) => showToast("error", "Failed to add", err.message),
  });
}


export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => apiFetch("/config"),
    refetchInterval: false,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates) =>
      apiFetch("/config", { method: "PUT", body: updates }),
    onSuccess: () => {
      // Toasts are owned by the calling component so each section can use
      // its own copy ("Disks saved", "Thresholds saved", etc.).
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["all-disks"] });
      qc.invalidateQueries({ queryKey: ["disks"] });
      qc.invalidateQueries({ queryKey: ["system-health"] });
    },
  });
}

export function useTestService() {
  return useMutation({
    mutationFn: ({ service, config }) =>
      apiFetch(`/config/test/${service}`, { method: "POST", body: config || null }),
  });
}


export function useMediaStats() {
  return useQuery({
    queryKey: ["media-stats"],
    queryFn: () => apiFetch("/system/media"),
  });
}


export function useNotificationChannels() {
  return useQuery({
    queryKey: ["notification-channels"],
    queryFn: () => apiFetch("/notifications/channels"),
    refetchInterval: false,
  });
}

export function useAddChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiFetch("/notifications/channels", { method: "POST", body: data }),
    onSuccess: () => {
      showToast("success", "Channel added");
      qc.invalidateQueries({ queryKey: ["notification-channels"] });
    },
    onError: (err) => showToast("error", "Failed to add channel", err.message),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiFetch(`/notifications/channels/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      showToast("success", "Channel removed");
      qc.invalidateQueries({ queryKey: ["notification-channels"] });
      qc.invalidateQueries({ queryKey: ["notification-rules"] });
    },
    onError: (err) => showToast("error", "Failed to remove channel", err.message),
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: (id) => apiFetch(`/notifications/channels/${id}/test`, { method: "POST" }),
    onSuccess: (data) => {
      showToast(data.ok ? "success" : "error", data.ok ? "Test sent" : "Test failed", data.message);
    },
    onError: (err) => showToast("error", "Test failed", err.message),
  });
}

export function useTestChannelDraft() {
  return useMutation({
    mutationFn: (payload) =>
      apiFetch("/notifications/channels/test", { method: "POST", body: payload }),
    onSuccess: (data) => {
      showToast(data.ok ? "success" : "error", data.ok ? "Test sent" : "Test failed", data.message);
    },
    onError: (err) => showToast("error", "Test failed", err.message),
  });
}

export function useNotificationRules() {
  return useQuery({
    queryKey: ["notification-rules"],
    queryFn: () => apiFetch("/notifications/rules"),
    refetchInterval: false,
  });
}

export function useAddRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiFetch("/notifications/rules", { method: "POST", body: data }),
    onSuccess: () => {
      showToast("success", "Rule added");
      qc.invalidateQueries({ queryKey: ["notification-rules"] });
    },
    onError: (err) => showToast("error", "Failed to add rule", err.message),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiFetch(`/notifications/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      showToast("success", "Rule removed");
      qc.invalidateQueries({ queryKey: ["notification-rules"] });
    },
    onError: (err) => showToast("error", "Failed to remove rule", err.message),
  });
}

export function useSendHealthNotification() {
  return useMutation({
    mutationFn: () => apiFetch("/notifications/health-check", { method: "POST" }),
    onSuccess: (data) => {
      showToast(
        data.ok ? "success" : "warning",
        "Health notification",
        `Sent to ${data.sent} channels${data.failed > 0 ? `, ${data.failed} failed` : ""}`,
      );
    },
    onError: (err) => showToast("error", "Notification error", err.message),
  });
}


export function useServiceRegistry() {
  return useQuery({
    queryKey: ["service-registry"],
    queryFn: () => apiFetch("/config/registry"),
    refetchInterval: false,
    staleTime: Infinity,
  });
}


export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch("/setup/status"),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSetupSystemCheck() {
  return useQuery({
    queryKey: ["setup-system-check"],
    queryFn: () => apiFetch("/setup/system-check"),
    refetchInterval: false,
    retry: false,
  });
}

export function useSetupDiscover() {
  return useQuery({
    queryKey: ["setup-discover"],
    queryFn: () => apiFetch("/setup/discover"),
    refetchInterval: false,
    retry: false,
  });
}

export function useSetupAuth() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/auth", { method: "POST", body }),
  });
}

export function useSetupDisks() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/disks", { method: "POST", body }),
  });
}

export function useSetupServices() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/services", { method: "POST", body }),
  });
}

export function useSetupNotifications() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/notifications", { method: "POST", body }),
  });
}

export function useSetupTestNotification() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/test-notification", { method: "POST", body }),
  });
}

export function useSetupThresholds() {
  return useMutation({
    mutationFn: (body) => apiFetch("/setup/thresholds", { method: "POST", body }),
  });
}

export function useSetupComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/setup/complete", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      qc.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}

export function useSetupReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/setup/reset", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setup-status"] });
    },
    onError: (err) => showToast("error", "Failed to reset setup", err.message),
  });
}


export function useUpdateAuthConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch("/auth/config", { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}

export function useRegenerateApiKey() {
  return useMutation({
    mutationFn: () => apiFetch("/auth/apikey/regenerate", { method: "POST" }),
  });
}
