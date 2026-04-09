import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  HardDriveIcon,
  SearchIcon,
  TvIcon,
  AlertTriangleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
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
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";
import {
  useShowDetail,
  useDownloads,
  useSearchMissing,
  useSeasonSearch,
  useEpisodeSearch,
} from "@/hooks/use-api";
import { cn, formatDate, formatSize } from "@/lib/utils";

const STATUS_CONFIG = {
  continuing: { label: "Continuing", variant: "success" },
  ended: { label: "Ended", variant: "secondary" },
  unmonitored: { label: "Unmonitored", variant: "secondary" },
};

// Grace window after air time before an episode is considered "missing".
// Indexers/release groups typically need at least a few hours, and we don't
// want to nag users about an episode that aired an hour ago.
const MISSING_GRACE_HOURS = 24;

function isAired(ep) {
  const airDate = ep.airDate ? new Date(ep.airDate) : null;
  return Boolean(airDate && airDate <= new Date());
}

function isWithinGrace(ep) {
  const airDate = ep.airDate ? new Date(ep.airDate) : null;
  if (!airDate) return false;
  const cutoff = new Date(airDate.getTime() + MISSING_GRACE_HOURS * 3600 * 1000);
  return airDate <= new Date() && new Date() < cutoff;
}

function isEpisodeMissing(ep) {
  if (ep.hasFile) return false;
  if (!isAired(ep)) return false;
  if (isWithinGrace(ep)) return false;
  return true;
}

function EpisodeStatusIcon({ episode, download }) {
  if (download) {
    return (
      <Tooltip>
        <TooltipTrigger className="cursor-default">
          <ArrowDownIcon className="size-4 text-blue-500 animate-pulse" />
        </TooltipTrigger>
        <TooltipPopup>
          Downloading {download.pct}%{download.time_left ? `, ${download.time_left} left` : ""}
        </TooltipPopup>
      </Tooltip>
    );
  }
  if (episode.hasFile) {
    return <CheckCircle2Icon className="size-4 text-emerald-500" />;
  }
  if (!isAired(episode) || isWithinGrace(episode)) {
    return (
      <Tooltip>
        <TooltipTrigger className="cursor-default">
          <ClockIcon className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipPopup>
          {isAired(episode)
            ? "Recently aired, waiting for a release"
            : "Not yet aired"}
        </TooltipPopup>
      </Tooltip>
    );
  }
  return <AlertTriangleIcon className="size-4 text-amber-500" />;
}

function SeasonSection({ season, showId, downloadsByEpId }) {
  const seasonSearch = useSeasonSearch();
  const episodeSearch = useEpisodeSearch();

  const missingCount = season.episodes.filter(isEpisodeMissing).length;
  const downloadingCount = season.episodes.filter((ep) => downloadsByEpId[ep.id]).length;
  // Specials stay collapsed by default, they're opt-in browsing, not the
  // primary content of a show.
  const [open, setOpen] = useState(
    !season.isSpecials && (missingCount > 0 || downloadingCount > 0),
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50">
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
        <span className="font-semibold">
          {season.isSpecials ? "Specials" : `Season ${season.seasonNumber}`}
        </span>
        {season.isSpecials && (
          <Badge variant="outline" size="sm">
            Not counted
          </Badge>
        )}
        {downloadingCount > 0 && (
          <Badge variant="info" size="sm">
            <ArrowDownIcon className="mr-0.5 size-3" />
            {downloadingCount} downloading
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {season.episodeFileCount}/{season.episodeCount} episodes
          </span>
          <div className="w-20">
            <Progress value={season.percentComplete}>
              <ProgressTrack className="h-1.5">
                <ProgressIndicator
                  className={cn(
                    season.percentComplete === 100
                      ? "bg-emerald-500"
                      : season.percentComplete > 0
                        ? "bg-primary"
                        : "bg-muted-foreground"
                  )}
                />
              </ProgressTrack>
            </Progress>
          </div>
          <span className="w-10 text-right tabular-nums">{season.percentComplete}%</span>
          <span className="hidden sm:inline">{formatSize(season.sizeOnDisk)}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-1 rounded-lg border bg-card overflow-hidden">
          {/* Season action bar */}
          {missingCount > 0 && (
            <div className="flex items-center gap-2 border-b px-4 py-2 bg-muted/30">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  seasonSearch.mutate({
                    showId,
                    seasonNumber: season.seasonNumber,
                  })
                }
                disabled={seasonSearch.isPending}
              >
                <SearchIcon className="mr-1 size-3" />
                Search Season ({missingCount} missing)
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden sm:table-cell">Air Date</TableHead>
                <TableHead className="w-12 text-center">Status</TableHead>
                <TableHead className="hidden md:table-cell">Quality</TableHead>
                <TableHead className="hidden md:table-cell text-right">Size</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {season.episodes.map((ep) => {
                const missing = isEpisodeMissing(ep);
                const download = downloadsByEpId[ep.id];
                return (
                  <TableRow
                    key={ep.id}
                    className={cn(
                      // Dim only undownloaded unmonitored episodes, once a
                      // file exists, monitoring state is mostly cosmetic and
                      // dimming reads as "something's wrong".
                      !ep.monitored && !ep.hasFile && "opacity-50",
                      download && "bg-blue-500/5",
                      !download && missing && "bg-amber-500/5",
                      !download && ep.hasFile && "bg-emerald-500/3",
                    )}
                  >
                    <TableCell className="tabular-nums text-muted-foreground">
                      {ep.episodeNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{ep.title || "TBA"}</div>
                      {download ? (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-24">
                            <Progress value={download.pct}>
                              <ProgressTrack className="h-1">
                                <ProgressIndicator className="bg-blue-500" />
                              </ProgressTrack>
                            </Progress>
                          </div>
                          <span className="text-[10px] text-blue-500 tabular-nums">
                            {download.pct}%
                          </span>
                          {download.time_left && (
                            <span className="text-[10px] text-muted-foreground">
                              {download.time_left}
                            </span>
                          )}
                        </div>
                      ) : (
                        ep.overview && (
                          <div className="text-xs text-muted-foreground line-clamp-1 max-w-md mt-0.5">
                            {ep.overview}
                          </div>
                        )
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {formatDate(ep.airDate)}
                    </TableCell>
                    <TableCell className="text-center">
                      <EpisodeStatusIcon episode={ep} download={download} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {ep.quality || ", "}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right text-muted-foreground tabular-nums">
                      {ep.size ? formatSize(ep.size) : ", "}
                    </TableCell>
                    <TableCell>
                      {missing && !download && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0"
                                onClick={() => episodeSearch.mutate([ep.id])}
                                disabled={episodeSearch.isPending}
                              />
                            }
                          >
                            <SearchIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup>Search episode</TooltipPopup>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export default function ShowDetail() {
  const { id } = useParams();
  const { data: show, isLoading, error } = useShowDetail(id);
  const { data: queue } = useDownloads();
  const searchMissing = useSearchMissing();

  // Build a map of episodeId -> download info for this show
  const downloadsByEpId = useMemo(() => {
    if (!queue || !id) return {};
    const map = {};
    for (const item of queue) {
      if (item.app === "sonarr" && String(item.seriesId) === String(id) && item.episodeId) {
        map[item.episodeId] = item;
      }
    }
    return map;
  }, [queue, id]);

  const downloadingCount = Object.keys(downloadsByEpId).length;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !show) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Show not found</p>
        <Button variant="outline" asChild>
          <Link to="/shows">
            <ArrowLeftIcon className="mr-2 size-4" />
            Back to Shows
          </Link>
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[show.status] || STATUS_CONFIG.continuing;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        {show.fanart && (
          <div className="absolute inset-0">
            <img
              src={show.fanart}
              alt=""
              className="h-full w-full object-cover object-top"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/95 to-card/70 dark:from-card dark:via-card/95 dark:to-card/60" />
          </div>
        )}

        <div className="relative flex gap-6 p-6">
          {show.poster && (
            <img
              src={show.poster}
              alt={show.title}
              className="hidden sm:block w-32 md:w-40 rounded-lg shadow-lg object-cover aspect-[2/3]"
            />
          )}

          <div className="flex flex-1 flex-col justify-end gap-3">
            <div>
              <Link
                to="/shows"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ArrowLeftIcon className="size-3.5" />
                Shows
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold">{show.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-muted-foreground">
                {show.year && <span>{show.year}</span>}
                {show.network && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{show.network}</span>
                  </>
                )}
                {show.runtime > 0 && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{show.runtime}m</span>
                  </>
                )}
                <Badge variant={statusConfig.variant} size="sm">
                  {statusConfig.label}
                </Badge>
                {downloadingCount > 0 && (
                  <Badge variant="info" size="sm">
                    <ArrowDownIcon className="mr-0.5 size-3" />
                    {downloadingCount} downloading
                  </Badge>
                )}
              </div>
            </div>

            {show.genres?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {show.genres.slice(0, 5).map((g) => (
                  <Badge key={g} variant="outline" size="sm">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            {show.overview && (
              <p className="text-sm text-muted-foreground line-clamp-3 max-w-2xl">
                {show.overview}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={TvIcon}
          label="Seasons"
          value={show.seasonCount}
        />
        <StatCard
          icon={CheckCircle2Icon}
          label="Episodes"
          value={`${show.episodeFileCount}/${show.airedEpisodes}`}
          sub={`${show.percentComplete}%`}
        />
        <StatCard
          icon={HardDriveIcon}
          label="Size"
          value={formatSize(show.sizeOnDisk)}
        />
        <StatCard
          icon={AlertTriangleIcon}
          label="Missing"
          value={show.missingEpisodes}
          variant={show.missingEpisodes > 0 ? "warning" : "default"}
        />
      </div>

      {/* Actions */}
      {show.missingEpisodes > 0 && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => searchMissing.mutate(show.id)}
            disabled={searchMissing.isPending}
          >
            <SearchIcon className="mr-1.5 size-3.5" />
            Search All Missing ({show.missingEpisodes})
          </Button>
        </div>
      )}

      {/* Seasons */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Seasons</h2>
        <div className="space-y-2">
          {show.seasons?.map((season) => (
            <SeasonSection
              key={season.seasonNumber}
              season={season}
              showId={show.id}
              downloadsByEpId={downloadsByEpId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, variant = "default" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-lg font-semibold tabular-nums",
            variant === "warning" && "text-amber-500"
          )}
        >
          {value}
        </span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
