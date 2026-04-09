import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownAZIcon,
  CalendarClockIcon,
  CalendarIcon,
  ClockIcon,
  HardDriveIcon,
  PlusIcon,
  SearchIcon,
  TvIcon,
  CheckCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAddShow,
  useShowQualityProfiles,
  useShowSearch,
  useShows,
} from "@/hooks/use-api";
import { cn, formatDate, formatSize } from "@/lib/utils";

const STATUS_CONFIG = {
  continuing: { label: "Continuing", variant: "success" },
  ended: { label: "Ended", variant: "secondary" },
  unmonitored: { label: "Unmonitored", variant: "secondary" },
  incomplete: { label: "Incomplete", variant: "warning" },
};

const SORT_OPTIONS = [
  { value: "title", label: "Title", icon: ArrowDownAZIcon },
  { value: "year", label: "Year", icon: CalendarIcon },
  { value: "added", label: "Added", icon: ClockIcon },
  { value: "size", label: "Size", icon: HardDriveIcon },
];

const PAGE_SIZE = 50;

function ShowSearchResults({ query, qualityProfileId }) {
  const { data: results, isLoading } = useShowSearch(query);
  const addShow = useAddShow();
  const [addedIds, setAddedIds] = useState(new Set());
  const [pendingId, setPendingId] = useState(null);

  const handleAdd = (tvdbId) => {
    setPendingId(tvdbId);
    addShow.mutate(
      { tvdbId, qualityProfileId: qualityProfileId || 0 },
      {
        onSettled: () => setPendingId(null),
        onSuccess: (result) => {
          if (result.ok) setAddedIds((prev) => new Set([...prev, tvdbId]));
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}
      {results?.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground py-8">
          No shows found for &quot;{query}&quot;
        </p>
      )}
      {results?.map((show) => {
        const justAdded = addedIds.has(show.tvdbId);
        const isPending = pendingId === show.tvdbId;
        return (
          <div key={show.tvdbId} className="flex gap-3 rounded-lg border p-3">
            {show.poster ? (
              <img
                src={show.poster}
                alt=""
                className="h-24 w-16 shrink-0 rounded-md object-cover bg-muted"
                loading="lazy"
              />
            ) : (
              <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
                <TvIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{show.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {show.year} · {show.seasonCount} seasons
                    {show.network && ` · ${show.network}`}
                  </p>
                </div>
                {show.inLibrary || justAdded ? (
                  <Badge variant="success" className="shrink-0 text-[10px]">
                    <CheckCircleIcon className="size-3 mr-0.5" />
                    {justAdded ? "Added" : "In Library"}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleAdd(show.tvdbId)}
                    disabled={isPending}
                    className="shrink-0"
                  >
                    {isPending ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
                    Add
                  </Button>
                )}
              </div>
              {show.overview && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {show.overview}
                </p>
              )}
              {show.genres?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {show.genres.slice(0, 3).map((g) => (
                    <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Shows() {
  const { data: shows, isLoading, error, refetch } = useShows();
  const { data: qualityProfiles } = useShowQualityProfiles();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("title");
  const [filter, setFilter] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!shows) return [];
    let list = [...shows];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.network?.toLowerCase().includes(q) ||
          String(s.year).includes(q),
      );
    }

    if (filter === "incomplete") {
      list = list.filter((s) => (s.missingEpisodes ?? 0) > 0 && s.monitored);
    } else if (filter !== "all") {
      list = list.filter((s) => s.status === filter);
    }

    list.sort((a, b) => {
      if (sort === "title") return a.sortTitle.localeCompare(b.sortTitle);
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
      if (sort === "added") return (b.added || "").localeCompare(a.added || "");
      if (sort === "size") return (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0);
      return 0;
    });

    return list;
  }, [shows, search, sort, filter]);

  const handleOpenAddShow = () => {
    setSearchInput(search);
    setSearchQuery("");
    setSearchOpen(true);
  };

  const stats = useMemo(() => {
    const incomplete = shows?.filter((s) => (s.missingEpisodes ?? 0) > 0 && s.monitored).length ?? 0;
    return {
      total: shows?.length ?? 0,
      continuing: shows?.filter((s) => s.status === "continuing").length ?? 0,
      ended: shows?.filter((s) => s.status === "ended").length ?? 0,
      incomplete,
      airedEpisodes: shows?.reduce((sum, s) => sum + (s.airedEpisodes || s.totalEpisodeCount || 0), 0) ?? 0,
      downloadedEpisodes: shows?.reduce((sum, s) => sum + (s.episodeFileCount || 0), 0) ?? 0,
    };
  }, [shows]);

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

  const visibleShows = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Shows</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} shows · {stats.incomplete} incomplete · {stats.downloadedEpisodes}/{stats.airedEpisodes} aired episodes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Filter library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-48 sm:w-56"
            />
          </div>
          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <Button onClick={handleOpenAddShow}>
              <PlusIcon className="size-4" />
              Add Show
            </Button>
            <DialogPopup className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Search & Add Show</DialogTitle>
                <DialogDescription>Search TVDB to find and add shows to Sonarr</DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <form
                  className="mb-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearchQuery(searchInput);
                  }}
                >
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        placeholder="Search for a TV show..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-9"
                        autoFocus
                      />
                    </div>
                    <Button type="submit">Search</Button>
                  </div>
                  {qualityProfiles?.length > 1 && (
                    <div className="flex items-center gap-2 mt-2">
                      <label className="text-xs text-muted-foreground shrink-0">Quality:</label>
                      <select
                        value={selectedProfile}
                        onChange={(e) => setSelectedProfile(Number(e.target.value))}
                        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      >
                        <option value={0}>Default</option>
                        {qualityProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </form>
                {searchQuery && <ShowSearchResults query={searchQuery} qualityProfileId={selectedProfile} />}
              </DialogPanel>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
        </div>
      </div>

      {/* Filters + Sort */}
      <div className="flex flex-wrap items-center gap-2">
        {["all", "incomplete", "continuing", "ended", "unmonitored"].map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : STATUS_CONFIG[f]?.label || f}
          </Button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        {SORT_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={sort === opt.value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSort(opt.value)}
          >
            <opt.icon className="size-3.5" />
            <span className="hidden sm:inline">{opt.label}</span>
          </Button>
        ))}
      </div>

      {/* Show Table */}
      {filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>{search ? "No shows match your search" : "No shows found"}</p>
          <Button variant="outline" onClick={handleOpenAddShow}>
            <PlusIcon className="size-4" />
            Search & Add Shows
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-48">Episodes</TableHead>
                <TableHead className="w-20">Missing</TableHead>
                <TableHead className="w-24 text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleShows.map((show) => {
                const cfg = STATUS_CONFIG[show.status] || STATUS_CONFIG.continuing;
                const aired = show.airedEpisodes ?? show.totalEpisodeCount ?? 0;
                const downloaded = show.episodeFileCount ?? 0;
                const missing = show.missingEpisodes ?? 0;
                const pct = aired > 0 ? Math.round((downloaded / aired) * 100) : 100;
                const isComplete = missing === 0;

                return (
                  <TableRow key={show.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to={`/shows/${show.id}`}
                        className="block hover:underline focus:outline-none focus-visible:underline"
                      >
                        <span className="font-medium">{show.title}</span>
                        {show.network && (
                          <span className="ml-2 text-xs text-muted-foreground">{show.network}</span>
                        )}
                        {show.nextAiring && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarClockIcon className="size-3" />
                            Next: {formatDate(show.nextAiring)}
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link to={`/shows/${show.id}`} tabIndex={-1}>
                        <Badge variant={cfg.variant} className="text-[10px]">
                          {cfg.label}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link to={`/shows/${show.id}`} tabIndex={-1} className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground w-14 shrink-0">
                          {downloaded}/{aired}
                        </span>
                        <Progress
                          value={pct}
                          className="w-20 shrink-0"
                        >
                          <ProgressTrack className="h-1.5">
                            <ProgressIndicator
                              className={cn(isComplete && "bg-green-500")}
                            />
                          </ProgressTrack>
                        </Progress>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link to={`/shows/${show.id}`} tabIndex={-1}>
                        {missing > 0 ? (
                          <span className="text-xs font-medium text-amber-500">{missing}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">, </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link to={`/shows/${show.id}`} tabIndex={-1}>
                        <span className="text-xs text-muted-foreground">
                          {formatSize(show.sizeOnDisk)}
                        </span>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {visibleCount < filtered.length && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                Show more ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
