import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownAZIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeOffIcon,
  FilmIcon,
  HardDriveIcon,
  PlusIcon,
  SearchIcon,
  XCircleIcon,
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
  useAddMovie,
  useMovieQualityProfiles,
  useMovieSearch,
  useMovies,
} from "@/hooks/use-api";
import { cn, formatDate, formatSize } from "@/lib/utils";

const STATUS_CONFIG = {
  downloaded: { label: "Downloaded", variant: "success", icon: CheckCircleIcon },
  upcoming: { label: "Upcoming", variant: "info", icon: CalendarClockIcon },
  missing: { label: "Missing", variant: "warning", icon: XCircleIcon },
  unmonitored: { label: "Unmonitored", variant: "secondary", icon: EyeOffIcon },
};

const SORT_OPTIONS = [
  { value: "title", label: "Title", icon: ArrowDownAZIcon },
  { value: "year", label: "Year", icon: CalendarIcon },
  { value: "added", label: "Added", icon: ClockIcon },
  { value: "size", label: "Size", icon: HardDriveIcon },
];

function SearchResults({ query, qualityProfileId }) {
  const { data: results, isLoading } = useMovieSearch(query);
  const addMovie = useAddMovie();
  const [addedIds, setAddedIds] = useState(new Set());
  const [pendingId, setPendingId] = useState(null);

  const handleAdd = (tmdbId) => {
    setPendingId(tmdbId);
    addMovie.mutate(
      { tmdbId, qualityProfileId: qualityProfileId || 0 },
      {
        onSettled: () => setPendingId(null),
        onSuccess: (result) => {
          if (result.ok) setAddedIds((prev) => new Set([...prev, tmdbId]));
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
          No movies found for &quot;{query}&quot;
        </p>
      )}
      {results?.map((movie) => {
        const justAdded = addedIds.has(movie.tmdbId);
        const isPending = pendingId === movie.tmdbId;
        return (
          <div
            key={movie.tmdbId}
            className="flex gap-3 rounded-lg border p-3"
          >
            {movie.poster ? (
              <img
                src={movie.poster}
                alt=""
                className="h-24 w-16 shrink-0 rounded-md object-cover bg-muted"
                loading="lazy"
              />
            ) : (
              <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
                <FilmIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{movie.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {movie.year} · {movie.runtime}m
                    {movie.certification && ` · ${movie.certification}`}
                  </p>
                </div>
                {movie.inLibrary || justAdded ? (
                  <Badge variant="success" className="shrink-0 text-[10px]">
                    <CheckCircleIcon className="size-3 mr-0.5" />
                    {justAdded ? "Added" : "In Library"}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleAdd(movie.tmdbId)}
                    disabled={isPending}
                    className="shrink-0"
                  >
                    {isPending ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
                    Add
                  </Button>
                )}
              </div>
              {movie.overview && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {movie.overview}
                </p>
              )}
              {movie.genres?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {movie.genres.slice(0, 3).map((g) => (
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

const PAGE_SIZE = 50;

export default function Movies() {
  const { data: movies, isLoading, error, refetch } = useMovies();
  const { data: qualityProfiles } = useMovieQualityProfiles();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("title");
  const [filter, setFilter] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const openAddDialog = (prefill = "") => {
    setSearchInput(prefill);
    setSearchQuery("");
    setSearchOpen(true);
  };

  const filtered = useMemo(() => {
    if (!movies) return [];
    let list = [...movies];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) => m.title.toLowerCase().includes(q) || String(m.year).includes(q),
      );
    }

    if (filter !== "all") {
      list = list.filter((m) => m.status === filter);
    }

    list.sort((a, b) => {
      if (sort === "title") return a.sortTitle.localeCompare(b.sortTitle);
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
      if (sort === "added") return (b.added || "").localeCompare(a.added || "");
      if (sort === "size") return (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0);
      return 0;
    });

    return list;
  }, [movies, search, sort, filter]);

  const stats = useMemo(() => ({
    total: movies?.length ?? 0,
    downloaded: movies?.filter((m) => m.status === "downloaded").length ?? 0,
    upcoming: movies?.filter((m) => m.status === "upcoming").length ?? 0,
    missing: movies?.filter((m) => m.status === "missing").length ?? 0,
    unmonitored: movies?.filter((m) => m.status === "unmonitored").length ?? 0,
  }), [movies]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Movies</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} total · {stats.downloaded} downloaded · {stats.missing} missing · {stats.upcoming} upcoming
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
            <Button onClick={() => openAddDialog()}>
              <PlusIcon className="size-4" />
              Add Movie
            </Button>
            <DialogPopup className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Search & Add Movie</DialogTitle>
                <DialogDescription>Search TMDB to find and add movies to Radarr</DialogDescription>
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
                        placeholder="Search for a movie..."
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
                {searchQuery && <SearchResults query={searchQuery} qualityProfileId={selectedProfile} />}
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
        {["all", "downloaded", "upcoming", "missing", "unmonitored"].map((f) => (
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

      {/* Movie Table */}
      {filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>{search ? "No movies match your search" : "No movies found"}</p>
          <Button variant="outline" onClick={() => openAddDialog(search)}>
            <PlusIcon className="size-4" />
            Search & Add Movies
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24 text-right">Size</TableHead>
                <TableHead className="w-32 text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, visibleCount).map((movie) => {
                const cfg = STATUS_CONFIG[movie.status] || STATUS_CONFIG.missing;
                return (
                  <TableRow
                    key={movie.id}
                    className={cn("cursor-pointer")}
                  >
                    <TableCell>
                      <Link
                        to={`/movies/${movie.id}`}
                        className="flex flex-col gap-0.5 hover:underline underline-offset-2"
                      >
                        <span className="font-medium leading-snug">{movie.title}</span>
                        {movie.year && (
                          <span className="text-xs text-muted-foreground">{movie.year}</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link to={`/movies/${movie.id}`} className="flex flex-col gap-0.5">
                        <Badge variant={cfg.variant} className="w-fit text-[10px]">
                          {cfg.label}
                        </Badge>
                        {movie.status === "upcoming" && movie.releaseDate && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {formatDate(movie.releaseDate)}
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      <Link to={`/movies/${movie.id}`} className="block">
                        {formatSize(movie.sizeOnDisk)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      <Link to={`/movies/${movie.id}`} className="block">
                        {formatDate(movie.added)}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {visibleCount < filtered.length && (
            <div className="flex justify-center pt-2">
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
