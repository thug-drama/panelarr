import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpCircleIcon,
  ArrowUpDownIcon,
  ExternalLinkIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useContainerAction, useContainerUpdates, useContainers, usePullContainer } from "@/hooks/use-api";
import { useWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";

function ContainerLogs({ containerName, containerState }) {
  const [lines, setLines] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef(null);

  const onMessage = useCallback(
    (data) => {
      if (!isPaused) {
        setLines((prev) => {
          const next = [...prev, data];
          return next.length > 1000 ? next.slice(-500) : next;
        });
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
        });
      }
    },
    [isPaused],
  );

  const { isConnected } = useWebSocket(
    containerName ? `/ws/logs/${containerName}` : null,
    { onMessage, enabled: !!containerName },
  );

  const filteredLines = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={isConnected ? "success" : "secondary"}>
          {isConnected ? "Live" : "Disconnected"}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsPaused(!isPaused)}
        >
          {isPaused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLines([])}
        >
          Clear
        </Button>
        <Input
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 w-36 text-xs"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredLines.length} lines
        </span>
      </div>
      <div
        ref={scrollRef}
        className="h-80 overflow-auto rounded-lg bg-neutral-950 p-3 font-mono text-xs text-neutral-100"
      >
        {filteredLines.length === 0 ? (
          <span className="text-neutral-500">
            {lines.length > 0 ? "No lines match filter" : "Waiting for logs..."}
          </span>
        ) : (
          filteredLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function cleanImageName(image) {
  if (!image) return ", ";
  // Remove sha256 prefix
  if (image.startsWith("sha256:")) return image.slice(0, 19) + "...";
  // Remove registry prefix for cleaner display
  return image
    .replace(/^(ghcr\.io|lscr\.io|docker\.io)\//, "")
    .replace(/^library\//, "");
}

export default function Containers() {
  const { data: containers, isLoading, error, refetch } = useContainers();
  const { data: updateData } = useContainerUpdates();
  const containerAction = useContainerAction();
  const pullContainer = usePullContainer();
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState(null);
  const selectedContainer = containers?.find((c) => c.name === selectedName) ?? null;
  // Track pending action to prevent button flicker between mutation completion and poll refresh
  const [pendingAction, setPendingAction] = useState(null); // {name, action, expectedState}

  // Clear pending action when the container state matches what we expect
  useEffect(() => {
    if (pendingAction && selectedContainer) {
      const expected = pendingAction.expectedState;
      if (
        (expected === "running" && selectedContainer.state === "running") ||
        (expected === "exited" && selectedContainer.state !== "running")
      ) {
        setPendingAction(null);
      }
    }
  }, [pendingAction, selectedContainer]);

  function handleAction(name, action) {
    const expectedState = action === "stop" ? "exited" : "running";
    setPendingAction({ name, action, expectedState });
    containerAction.mutate({ name, action });
  }

  const isActionPending = !!pendingAction && pendingAction.name === selectedName;
  const [sort, setSort] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [filter, setFilter] = useState("all");
  const updates = updateData?.updates ?? {};

  const toggleSort = (col) => {
    if (sort === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let list = [...(containers ?? [])];

    // Filter by status
    if (filter === "running") list = list.filter((c) => c.state === "running");
    else if (filter === "stopped") list = list.filter((c) => c.state !== "running");
    else if (filter === "updates") list = list.filter((c) => updates[c.name]?.has_update);

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q),
      );
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * dir;
      if (sort === "status") return a.state.localeCompare(b.state) * dir;
      if (sort === "cpu") return ((a.cpu_percent ?? 0) - (b.cpu_percent ?? 0)) * dir;
      if (sort === "memory") {
        const ma = parseFloat(a.memory_usage) || 0;
        const mb = parseFloat(b.memory_usage) || 0;
        return (ma - mb) * dir;
      }
      return 0;
    });

    return list;
  }, [containers, search, sort, sortDir, filter, updates]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error.message}</p>
        <Button variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const runningCount = containers?.filter((c) => c.state === "running").length ?? 0;
  const stoppedCount = (containers?.length ?? 0) - runningCount;
  const updateCount = Object.values(updates).filter((u) => u.has_update).length;

  function SortHead({ col, children, className }) {
    return (
      <TableHead
        className={`cursor-pointer select-none hover:text-foreground ${className || ""}`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {sort === col && (
            <ArrowUpDownIcon className="size-3 text-primary" />
          )}
        </span>
      </TableHead>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Containers</h1>
        <div className="relative w-64">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search containers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: "all", label: `All (${containers?.length ?? 0})` },
          { value: "running", label: `Running (${runningCount})` },
          { value: "stopped", label: `Stopped (${stoppedCount})` },
          ...(updateCount > 0 ? [{ value: "updates", label: `Updates (${updateCount})` }] : []),
        ].map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead col="name">Name</SortHead>
              <SortHead col="status">Status</SortHead>
              <TableHead className="hidden md:table-cell">Image</TableHead>
              <TableHead className="hidden sm:table-cell">Uptime</TableHead>
              <SortHead col="cpu" className="hidden lg:table-cell">CPU</SortHead>
              <SortHead col="memory" className="hidden lg:table-cell">Memory</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => setSelectedName(c.name)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    {c.name}
                    {updates[c.name]?.has_update && (
                      <span title="Image update available" className="text-blue-500">
                        <ArrowUpCircleIcon className="size-3.5" />
                      </span>
                    )}
                    {c.urls?.length > 0 && (
                      <a
                        href={c.urls[0].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                        title={c.urls[0].url}
                      >
                        <ExternalLinkIcon className="size-3" />
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      c.state === "running"
                        ? "success"
                        : c.state === "restarting"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {c.state}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground text-xs truncate max-w-48" title={c.image}>
                  {cleanImageName(c.image)}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">
                  {c.uptime || ", "}
                </TableCell>
                <TableCell className="hidden lg:table-cell tabular-nums">
                  {c.state === "running" ? `${c.cpu_percent}%` : ", "}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {c.state === "running" ? c.memory_usage : ", "}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No containers found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Container Detail Sheet */}
      <Sheet open={!!selectedName} onOpenChange={(open) => !open && setSelectedName(null)}>
        <SheetPopup side="right" className="w-full max-w-lg">
          <SheetHeader>
            <SheetTitle>{selectedContainer?.name}</SheetTitle>
            <SheetDescription>{selectedContainer?.image}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge
                  variant={selectedContainer?.state === "running" ? "success" : "secondary"}
                >
                  {selectedContainer?.state}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-sm">{selectedContainer?.uptime || ", "}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CPU</p>
                <p className="text-sm tabular-nums">
                  {selectedContainer?.state === "running" ? `${selectedContainer.cpu_percent}%` : ", "}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Memory</p>
                <p className="text-sm">
                  {selectedContainer?.state === "running"
                    ? `${selectedContainer.memory_usage} / ${selectedContainer.memory_limit}`
                    : ", "}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Restarts</p>
                <p className="text-sm tabular-nums">{selectedContainer?.restart_count ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Container ID</p>
                <p className="text-sm font-mono">{selectedContainer?.id}</p>
              </div>
            </div>

            {selectedContainer?.urls?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Public URLs</p>
                <div className="flex flex-col gap-1">
                  {selectedContainer.urls.map((u) => (
                    <a
                      key={u.url}
                      href={u.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <ExternalLinkIcon className="size-3" />
                      {u.url}
                      <span className="text-xs text-muted-foreground">({u.source})</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {selectedContainer && updates[selectedContainer.name]?.has_update && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
                <div className="flex items-center gap-2">
                  <ArrowUpCircleIcon className="size-4 text-blue-500 shrink-0" />
                  <span>Update available</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => pullContainer.mutate(selectedContainer.name)}
                  disabled={pullContainer.isPending}
                >
                  {pullContainer.isPending ? <Spinner className="size-4" /> : <ArrowUpCircleIcon className="size-4" />}
                  Update
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              {isActionPending ? (
                <Button size="sm" disabled>
                  <Spinner className="size-4" />
                  {pendingAction.action === "stop" ? "Stopping..." : pendingAction.action === "start" ? "Starting..." : "Restarting..."}
                </Button>
              ) : selectedContainer?.state !== "running" ? (
                <Button
                  size="sm"
                  onClick={() => handleAction(selectedContainer.name, "start")}
                  disabled={pullContainer.isPending}
                >
                  <PlayIcon className="size-4" />
                  Start
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(selectedContainer.name, "restart")}
                    disabled={pullContainer.isPending}
                  >
                    <RotateCcwIcon className="size-4" />
                    Restart
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleAction(selectedContainer.name, "stop")}
                    disabled={pullContainer.isPending}
                  >
                    <SquareIcon className="size-4" />
                    Stop
                  </Button>
                </>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">Live Logs</h3>
              <ContainerLogs
                key={`${selectedContainer?.name}-${selectedContainer?.state}`}
                containerName={selectedContainer?.name}
                containerState={selectedContainer?.state}
              />
            </div>
          </div>
        </SheetPopup>
      </Sheet>
    </div>
  );
}
