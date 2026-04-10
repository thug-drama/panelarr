import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpCircleIcon,
  BoxIcon,
  CalendarDaysIcon,
  CpuIcon,
  DownloadIcon,
  FilmIcon,
  HardDriveIcon,
  HeartPulseIcon,
  LibraryIcon,
  HistoryIcon,
  MonitorPlayIcon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  ShieldCheckIcon,
  TvIcon,
  XIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  useBlocklistWarnings,
  useActiveTasks,
  useCalendar,
  useContainers,
  useDisks,
  useDownloadHistory,
  useSendHealthNotification,
  useDownloads,
  useDownloadStats,
  useLibraryStats,
  useMediaStats,
  useSystemHealth,
  useSystemInfo,
  useSelfUpdate,
  useVersionCheck,
} from "@/hooks/use-api";
import { CalendarAgendaRow } from "@/components/calendar-agenda-row";
import { cn, formatBytes } from "@/lib/utils";

function meterColor(pct, warn = 80, crit = 90) {
  if (pct >= crit) return "bg-red-500";
  if (pct >= warn) return "bg-amber-500";
  return "bg-primary";
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return "0 B/s";
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatCard({ icon: Icon, label, value, subValue, variant }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            variant === "success" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
            variant === "warning" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
            variant === "danger" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            variant === "info" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
            !variant && "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {subValue && (
            <p className="text-xs text-muted-foreground truncate">{subValue}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StreamCard({ stream }) {
  // Interpolate elapsed time between polls for smooth progress
  const [elapsed, setElapsed] = useState(stream.view_offset_ms);

  useEffect(() => {
    setElapsed(stream.view_offset_ms);
  }, [stream.view_offset_ms]);

  useEffect(() => {
    if (stream.state === "paused") return;
    const interval = setInterval(() => {
      setElapsed((prev) => Math.min(prev + 1000, stream.duration_ms));
    }, 1000);
    return () => clearInterval(interval);
  }, [stream.state, stream.duration_ms]);

  const progressPct = stream.duration_ms > 0 ? Math.round((elapsed / stream.duration_ms) * 100) : 0;

  return (
    <div className="flex gap-3 rounded-lg border p-3">
      {stream.thumb_url ? (
        <img
          src={stream.thumb_url}
          alt=""
          className="h-20 w-14 shrink-0 rounded-md object-cover bg-muted"
          loading="lazy"
        />
      ) : (
        <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-muted">
          <FilmIcon className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div>
          <p className="truncate text-sm font-medium">{stream.title}</p>
          <p className="text-xs text-muted-foreground">
            {stream.user} on {stream.device}
          </p>
          {stream.address && (
            <span className="text-xs text-muted-foreground">{stream.address}</span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {stream.state === "paused" ? (
                <PauseIcon className="size-3" />
              ) : (
                <PlayIcon className="size-3" />
              )}
              {stream.video_decision === "transcode" ? "Transcoding" : "Direct Play"}
            </span>
            <span className="tabular-nums">
              {formatDuration(elapsed)} / {formatDuration(stream.duration_ms)}
            </span>
          </div>
          <Progress value={progressPct}>
            <ProgressTrack className="h-1">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>
      </div>
    </div>
  );
}

function UpdateBanner() {
  const { data } = useVersionCheck();
  const selfUpdate = useSelfUpdate();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!data?.update_available || isDismissed) return null;

  async function handleUpdate() {
    setIsUpdating(true);
    try {
      await selfUpdate.mutateAsync();
    } catch {
      // Container may die before responding
    }
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
    setTimeout(() => clearInterval(poll), 120_000);
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ArrowUpCircleIcon className="size-5 shrink-0 text-brand" />
          <div>
            <p className="text-sm font-medium">
              Panelarr v{data.latest} is available
            </p>
            <p className="text-xs text-muted-foreground">
              You're running v{data.current}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleUpdate} disabled={isUpdating}>
            {isUpdating ? (
              <>
                <Spinner className="size-3" />
                Updating...
              </>
            ) : (
              "Update now"
            )}
          </Button>
          {!isUpdating && (
            <button
              onClick={() => setIsDismissed(true)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: containers, isLoading: containersLoading } = useContainers();
  const { data: health, isLoading: healthLoading } = useSystemHealth();
  const { data: disks } = useDisks();
  const { data: sysInfo } = useSystemInfo();
  const { data: downloads, isLoading: downloadsLoading } = useDownloads();
  const { data: stats } = useDownloadStats();
  const { data: media } = useMediaStats();
  const { data: libraryStats } = useLibraryStats();
  const { data: history } = useDownloadHistory();
  const { data: activeTasks } = useActiveTasks();
  const healthNotify = useSendHealthNotification();
  const blocklistAll = useBlocklistWarnings();

  // Upcoming releases, query the next 30 days and slice to the soonest 5
  const upcomingWindow = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 30);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { start: fmt(start), end: fmt(end), nowMs: now.getTime() };
  }, []);
  // Match the calendar page defaults: hide specials, hide downloaded, and
  // skip unmonitored items so the widget surfaces only what the user is
  // actually waiting on.
  const { data: calendarData } = useCalendar({
    start: upcomingWindow.start,
    end: upcomingWindow.end,
    kind: "all",
    includeUnmonitored: false,
    includeSpecials: false,
    includeDownloaded: false,
  });
  const upcomingItems = useMemo(() => {
    const items = calendarData?.items || [];
    return items
      .filter((it) => new Date(it.air_date_utc).getTime() >= upcomingWindow.nowMs)
      .slice(0, 5);
  }, [calendarData, upcomingWindow.nowMs]);

  const isLoading = containersLoading || healthLoading || downloadsLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  const running = containers?.filter((c) => c.state === "running").length ?? 0;
  const total = containers?.length ?? 0;
  const warningDownloads = downloads?.filter((d) => d.warning) ?? [];
  const activeDownloads = downloads?.filter((d) => d.status === "downloading") ?? [];
  const torrentActive = stats?.torrent_active ?? 0;
  const nzbActive = stats?.nzb_active ?? 0;
  // Disks come from the dedicated /system/disk endpoint (fast, no Docker
  // fan-out) so toggling the selection in Settings reflects immediately.
  // Fall back to the health payload only on the very first render.
  const diskList = disks ?? health?.disk ?? [];
  const worstDisk = diskList.reduce((a, b) => (a.pct > b.pct ? a : b), { pct: 0 });
  const diskSummary = diskList.map((d) => `${d.mount} ${d.pct}%`).join(" · ");

  // Media streams
  const plexStreams = media?.plex?.streams ?? [];
  const plexConfigured = media?.plex?.configured;

  // Library counts, combine ARR stats and Plex counts
  const libEntries = Object.entries(libraryStats ?? {});
  const totalMovies = libraryStats?.radarr?.total ?? media?.plex?.total_movies ?? 0;
  const totalShows = libraryStats?.sonarr?.total ?? media?.plex?.total_shows ?? 0;
  const hasLibrary = totalMovies > 0 || totalShows > 0 || libEntries.length > 0;

  return (
    <div className="space-y-6">
      <UpdateBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={healthNotify.isPending} />}>
              {healthNotify.isPending ? <Spinner className="size-4" /> : <SendIcon className="size-4" />}
              <span className="hidden sm:inline">Health Report</span>
            </AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Send Health Report</AlertDialogTitle>
                <AlertDialogDescription>
                  Send system health to all configured notification channels.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                <AlertDialogClose render={<Button onClick={() => healthNotify.mutate()} />}>Send</AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={BoxIcon}
          label="Containers"
          value={`${running}/${total}`}
          variant={running === total ? "success" : "warning"}
        />
        <StatCard
          icon={DownloadIcon}
          label="Downloads"
          value={`${torrentActive}T / ${nzbActive}N`}
          subValue={activeDownloads.length > 0 ? `${activeDownloads.length} active` : "Idle"}
          variant={activeDownloads.length > 0 ? "info" : "success"}
        />
        <StatCard
          icon={HardDriveIcon}
          label="Disk Usage"
          value={worstDisk?.pct ? `${worstDisk.pct}%` : "N/A"}
          subValue={diskSummary}
          variant={
            worstDisk?.pct >= 90
              ? "danger"
              : worstDisk?.pct >= 80
                ? "warning"
                : "success"
          }
        />
        <StatCard
          icon={HeartPulseIcon}
          label="System"
          value={health?.status ?? "unknown"}
          subValue={
            health?.issues?.length > 0
              ? health.issues[0]
              : health?.uptime ? `Up ${health.uptime}` : undefined
          }
          variant={
            health?.status === "healthy"
              ? "success"
              : health?.status === "degraded"
                ? "warning"
                : "danger"
          }
        />
      </div>

      {/* Service Status Badges */}
      <div className="flex flex-wrap gap-2">
        {stats?.qbittorrent?.configured && stats.qbittorrent.vpn_active !== undefined && (
          <Badge variant={stats.qbittorrent.vpn_active ? "success" : "destructive"}>
            <ShieldCheckIcon className="size-3 mr-1" />
            VPN: {stats.qbittorrent.vpn_active ? (stats.qbittorrent.vpn_interface || "Active") : "Off"}
          </Badge>
        )}
        {stats?.qbittorrent?.configured && !stats.qbittorrent.error && (
          <Badge variant="outline">qBit: {formatSpeed(stats.qbittorrent.speed_down)} ↓</Badge>
        )}
        {stats?.sabnzbd?.configured && !stats.sabnzbd.error && (
          <Badge variant="outline">SAB: {stats.sabnzbd.speed || "Idle"}</Badge>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Media Library Card */}
          {hasLibrary && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LibraryIcon className="size-4" />
                  Media Library
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {totalMovies > 0 && (
                    <Link to="/movies" className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-muted/50">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        <FilmIcon className="size-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{totalMovies.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Movies →</p>
                      </div>
                    </Link>
                  )}
                  {totalShows > 0 && (
                    <Link to="/shows" className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-muted/50">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        <TvIcon className="size-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{totalShows.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Shows →</p>
                      </div>
                    </Link>
                  )}
                  {libEntries
                    .filter(([name]) => name !== "sonarr" && name !== "radarr")
                    .map(([name, data]) => (
                      <div key={name} className="flex items-center gap-3 rounded-lg border p-4">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                          <LibraryIcon className="size-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold tabular-nums">{data.total.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{data.label}</p>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Now Streaming Card */}
          {plexConfigured && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MonitorPlayIcon className="size-4" />
                  Now Streaming
                  {plexStreams.length > 0 && (
                    <Badge variant="info" className="ml-auto">{plexStreams.length} active</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {plexStreams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active streams</p>
                ) : (
                  <div className="space-y-3">
                    {plexStreams.map((stream, i) => (
                      <StreamCard key={i} stream={stream} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Upcoming releases */}
          {upcomingItems.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <CalendarDaysIcon className="size-4" />
                  Upcoming
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/calendar">View calendar →</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {upcomingItems.map((item) => (
                    <CalendarAgendaRow key={`${item.source}-${item.id}`} item={item} showDate />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Server Stats */}
          {sysInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CpuIcon className="size-4" />
                  Server
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">CPU</p>
                    <p className="font-medium truncate">{sysInfo.cpu_model || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">
                      {sysInfo.cpu_count} cores · {sysInfo.cpu_pct}% usage
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Memory</p>
                    <p className="font-medium">{formatBytes(sysInfo.memory_used)} / {formatBytes(sysInfo.memory_total)}</p>
                    <p className="text-xs text-muted-foreground">{sysInfo.memory_pct}% used</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">OS</p>
                    <p className="font-medium truncate">{sysInfo.os}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Load Average</p>
                    <p className="font-medium tabular-nums">
                      {sysInfo.load_average?.map((l) => l.toFixed(2)).join(", ")}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>RAM</span>
                    <span>{sysInfo.memory_pct}%</span>
                  </div>
                  <Meter value={sysInfo.memory_pct} min={0} max={100}>
                    <MeterTrack>
                      <MeterIndicator className={meterColor(sysInfo.memory_pct)} />
                    </MeterTrack>
                  </Meter>
                </div>
                {sysInfo.swap_total > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Swap</span>
                      <span>{sysInfo.swap_pct}%</span>
                    </div>
                    <Meter value={sysInfo.swap_pct} min={0} max={100}>
                      <MeterTrack>
                        <MeterIndicator className={meterColor(sysInfo.swap_pct)} />
                      </MeterTrack>
                    </Meter>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Disk Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDriveIcon className="size-4" />
                Disk Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {diskList.map((d) => (
                <div key={d.mount} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{d.mount}</span>
                    <span className={cn(
                      "tabular-nums",
                      d.pct >= 90 ? "text-red-500" : d.pct >= 80 ? "text-amber-500" : "text-muted-foreground"
                    )}>
                      {d.pct}%, {formatBytes(d.free)} free / {formatBytes(d.total)}
                    </span>
                  </div>
                  <Meter value={d.pct} min={0} max={100}>
                    <MeterTrack>
                      <MeterIndicator className={meterColor(d.pct, 80, 90)} />
                    </MeterTrack>
                  </Meter>
                </div>
              ))}
              {diskList.length === 0 && (
                <p className="text-sm text-muted-foreground">No disk information available</p>
              )}
            </CardContent>
          </Card>

          {/* Download Queue */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <DownloadIcon className="size-4" />
                Download Queue
              </CardTitle>
              {warningDownloads.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="destructive" size="sm" disabled={blocklistAll.isPending} />}>
                    {blocklistAll.isPending ? <Spinner className="size-4" /> : null}
                    Blocklist Warnings ({warningDownloads.length})
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Blocklist All Warnings</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will blocklist {warningDownloads.length} items with warnings and search for new releases.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                      <AlertDialogClose render={<Button variant="destructive" onClick={() => blocklistAll.mutate()} />}>
                        Blocklist All
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>
              )}
            </CardHeader>
            <CardContent>
              {downloads?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active downloads</p>
              ) : (
                <div className="space-y-3">
                  {downloads?.slice(0, 8).map((dl) => (
                    <div key={`${dl.app}-${dl.id}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{dl.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={dl.protocol === "torrent" ? "default" : "secondary"} className="text-[10px]">
                            {dl.protocol === "usenet" ? "NZB" : "Torrent"}
                          </Badge>
                          {dl.warning && (
                            <Badge variant="warning" className="text-[10px]">warn</Badge>
                          )}
                        </div>
                      </div>
                      <Progress value={dl.pct}>
                        <ProgressTrack>
                          <ProgressIndicator />
                        </ProgressTrack>
                      </Progress>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HistoryIcon className="size-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Active tasks (imports, searches only) */}
              {activeTasks?.map((task) => (
                <div key={`task-${task.app}-${task.id}`} className="flex items-center gap-2 text-sm">
                  <span className="size-2 shrink-0 rounded-full bg-primary animate-pulse" />
                  <span className="truncate flex-1">{task.label}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{task.app}</Badge>
                </div>
              ))}
              {/* Recent history (grabbed, imported, failed only) */}
              {history?.slice(0, 5).map((item) => {
                const variant = item.eventLabel === "Failed" ? "destructive"
                  : item.eventLabel === "Imported" ? "success"
                  : item.eventLabel === "Grabbed" ? "default"
                  : "secondary";
                return (
                  <div key={`${item.app}-${item.id}`} className="flex items-center gap-2 text-sm">
                    <Badge variant={variant} className="text-[10px] shrink-0 w-16 justify-center">
                      {item.eventLabel}
                    </Badge>
                    <span className="truncate flex-1 text-muted-foreground">{item.title}</span>
                    {item.quality && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.quality}</span>
                    )}
                  </div>
                );
              })}
              {(!activeTasks?.length && !history?.length) && (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
