import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  FilmIcon,
  HardDriveIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useMovieDetail, useDownloads, useMovieSearchAction } from "@/hooks/use-api";
import { cn, formatDate, formatSize } from "@/lib/utils";

const STATUS_CONFIG = {
  downloaded: { label: "Downloaded", variant: "success" },
  missing: { label: "Missing", variant: "warning" },
  unmonitored: { label: "Unmonitored", variant: "secondary" },
  downloading: { label: "Downloading", variant: "info" },
  importing: { label: "Importing", variant: "info" },
};

export default function MovieDetail() {
  const { id } = useParams();
  const { data: movie, isLoading, error } = useMovieDetail(id);
  const { data: queue } = useDownloads();
  const searchMovie = useMovieSearchAction();

  // Find download queue item for this movie
  const download = useMemo(() => {
    if (!queue || !id) return null;
    return queue.find(
      (item) => item.app === "radarr" && String(item.movieId) === String(id)
    ) || null;
  }, [queue, id]);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Movie not found</p>
        <Button variant="outline" asChild>
          <Link to="/movies">
            <ArrowLeftIcon className="mr-2 size-4" />
            Back to Movies
          </Link>
        </Button>
      </div>
    );
  }

  // Override status if currently downloading/importing
  let effectiveStatus = movie.status;
  if (download) {
    effectiveStatus = download.status === "importing" ? "importing" : "downloading";
  }
  const statusConfig = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.missing;
  const imdbRating = movie.ratings?.imdb?.value;
  const tmdbRating = movie.ratings?.tmdb?.value;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        {movie.fanart && (
          <div className="absolute inset-0">
            <img
              src={movie.fanart}
              alt=""
              className="h-full w-full object-cover object-top"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/95 to-card/70 dark:from-card dark:via-card/95 dark:to-card/60" />
          </div>
        )}

        <div className="relative flex gap-6 p-6">
          {movie.poster && (
            <img
              src={movie.poster}
              alt={movie.title}
              className="hidden sm:block w-32 md:w-40 rounded-lg shadow-lg object-cover aspect-[2/3]"
            />
          )}

          <div className="flex flex-1 flex-col justify-end gap-3">
            <div>
              <Link
                to="/movies"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ArrowLeftIcon className="size-3.5" />
                Movies
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold">{movie.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-muted-foreground">
                {movie.year && <span>{movie.year}</span>}
                {movie.certification && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <Badge variant="outline" size="sm">{movie.certification}</Badge>
                  </>
                )}
                {movie.runtime > 0 && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{movie.runtime}m</span>
                  </>
                )}
                {movie.studio && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{movie.studio}</span>
                  </>
                )}
                <Badge variant={statusConfig.variant} size="sm">
                  {statusConfig.label}
                </Badge>
              </div>
            </div>

            {movie.genres?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {movie.genres.slice(0, 5).map((g) => (
                  <Badge key={g} variant="outline" size="sm">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            {movie.overview && (
              <p className="text-sm text-muted-foreground line-clamp-4 max-w-2xl">
                {movie.overview}
              </p>
            )}

            {/* Ratings */}
            {(imdbRating || tmdbRating) && (
              <div className="flex items-center gap-4 text-sm">
                {imdbRating && (
                  <div className="flex items-center gap-1">
                    <StarIcon className="size-3.5 text-amber-400 fill-amber-400" />
                    <span className="font-medium">{imdbRating.toFixed(1)}</span>
                    <span className="text-muted-foreground">IMDb</span>
                  </div>
                )}
                {tmdbRating && (
                  <div className="flex items-center gap-1">
                    <StarIcon className="size-3.5 text-amber-400 fill-amber-400" />
                    <span className="font-medium">{tmdbRating.toFixed(1)}</span>
                    <span className="text-muted-foreground">TMDB</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Download progress */}
      {download && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <ArrowDownIcon className="size-5 text-blue-500 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium">
                    {download.status === "importing" ? "Importing..." : "Downloading..."}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {download.pct}%
                    {download.time_left && `, ${download.time_left} left`}
                  </span>
                </div>
                <Progress value={download.pct}>
                  <ProgressTrack className="h-2">
                    <ProgressIndicator className="bg-blue-500" />
                  </ProgressTrack>
                </Progress>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span>{formatSize(download.size - download.sizeleft)} / {formatSize(download.size)}</span>
                  {download.indexer && <span>via {download.indexer}</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={download ? ArrowDownIcon : movie.hasFile ? CheckCircle2Icon : ClockIcon}
          label="Status"
          value={statusConfig.label}
          variant={
            download ? "info" : movie.status === "missing" ? "warning" : "default"
          }
        />
        <StatCard
          icon={HardDriveIcon}
          label="Size"
          value={formatSize(movie.sizeOnDisk)}
        />
        <StatCard
          icon={CalendarIcon}
          label="Added"
          value={formatDate(movie.added)}
        />
        <StatCard
          icon={FilmIcon}
          label="Runtime"
          value={movie.runtime > 0 ? `${movie.runtime} min` : ", "}
        />
      </div>

      {/* Search action */}
      {movie.status === "missing" && !download && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => searchMovie.mutate(movie.id)}
            disabled={searchMovie.isPending}
          >
            {searchMovie.isPending ? (
              <Spinner className="mr-1.5 size-3.5" />
            ) : (
              <SearchIcon className="mr-1.5 size-3.5" />
            )}
            Search Movie
          </Button>
        </div>
      )}

      {/* File info */}
      {movie.movieFile && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">File Info</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <InfoRow label="Quality" value={movie.movieFile.quality} />
              <InfoRow label="Size" value={formatSize(movie.movieFile.size)} />
              <InfoRow
                label="File"
                value={movie.movieFile.relativePath}
                className="sm:col-span-2"
              />
              <InfoRow label="Added" value={formatDate(movie.movieFile.dateAdded)} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* External links */}
      <div className="flex flex-wrap gap-2">
        {movie.imdbId && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.imdb.com/title/${movie.imdbId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              IMDb
            </a>
          </Button>
        )}
        {movie.tmdbId && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              TMDB
            </a>
          </Button>
        )}
        {movie.youTubeTrailerId && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.youtube.com/watch?v=${movie.youTubeTrailerId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Trailer
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, variant = "default" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1">
        <span
          className={cn(
            "text-lg font-semibold",
            variant === "warning" && "text-amber-500",
            variant === "info" && "text-blue-500"
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function InfoRow({ label, value, className }) {
  return (
    <div className={className}>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium break-all">{value || ", "}</span>
    </div>
  );
}
