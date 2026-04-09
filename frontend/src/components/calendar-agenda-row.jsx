import { Link } from "react-router-dom";
import { FilmIcon, TvIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Single agenda row used by both the Calendar page and the dashboard
 * "Upcoming" widget. Renders a poster, title, subtitle, time, and a
 * media-kind badge, linking through to the show or movie detail page.
 */
export function CalendarAgendaRow({ item, showDate = false }) {
  const isEpisode = item.kind === "episode";
  const Icon = isEpisode ? TvIcon : FilmIcon;
  const airDate = new Date(item.air_date_utc);
  const time = airDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const dateLabel = showDate
    ? airDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  return (
    <Link
      to={item.deep_link || "#"}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/50",
        item.has_file && "opacity-60",
      )}
    >
      {item.poster_url ? (
        <img
          src={item.poster_url}
          alt=""
          loading="lazy"
          className="h-14 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.has_file && (
            <Badge variant="success" size="sm">
              Downloaded
            </Badge>
          )}
        </div>
        {item.subtitle && (
          <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        )}
      </div>
      <div className="text-right">
        {dateLabel && (
          <div className="text-xs font-medium tabular-nums text-foreground">{dateLabel}</div>
        )}
        <div className="text-xs tabular-nums text-muted-foreground">{time}</div>
        <Badge variant="outline" size="sm" className="mt-1">
          <Icon className="mr-1 size-3" />
          {isEpisode ? "Episode" : "Movie"}
        </Badge>
      </div>
    </Link>
  );
}
