import { useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  CalendarOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FilmIcon,
  TvIcon,
} from "lucide-react";

import { CalendarAgendaRow } from "@/components/calendar-agenda-row";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useCalendar } from "@/hooks/use-api";
import { cn } from "@/lib/utils";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}


function FilterChip({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted/50",
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
    </button>
  );
}


function AgendaList({ items, today }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const dt = new Date(item.air_date_utc);
      const key = isoDate(dt);
      if (!map.has(key)) map.set(key, { date: dt, items: [] });
      map.get(key).items.push(item);
    }
    return Array.from(map.values()).sort((a, b) => a.date - b.date);
  }, [items]);

  if (groups.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarOffIcon className="size-6" />
          </EmptyMedia>
          <EmptyTitle>Nothing scheduled</EmptyTitle>
          <EmptyDescription>
            No upcoming releases match your filters in this month.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(({ date, items: dayItems }) => {
        const isToday = sameDay(date, today);
        const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
        const dateLabel = date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        return (
          <div key={date.toISOString()}>
            <div
              className={cn(
                "sticky top-0 z-10 -mx-2 mb-2 flex items-baseline gap-2 px-2 py-1.5",
                "bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70",
              )}
            >
              <h3
                className={cn(
                  "text-sm font-semibold",
                  isToday && "text-primary",
                )}
              >
                {isToday ? "Today" : weekday}
              </h3>
              <span className="text-xs text-muted-foreground">{dateLabel}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                {dayItems.length} {dayItems.length === 1 ? "release" : "releases"}
              </span>
            </div>
            <div className="space-y-1.5">
              {dayItems.map((item) => (
                <CalendarAgendaRow key={`${item.source}-${item.id}`} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}


export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [kind, setKind] = useState("all");
  const [includeUnmonitored, setIncludeUnmonitored] = useState(false);
  const [includeSpecials, setIncludeSpecials] = useState(false);
  const [includeDownloaded, setIncludeDownloaded] = useState(true);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const start = useMemo(() => isoDate(startOfMonth(cursor)), [cursor]);
  const end = useMemo(() => isoDate(endOfMonth(cursor)), [cursor]);

  const { data, isLoading, isError, error } = useCalendar({
    start,
    end,
    kind,
    includeUnmonitored,
    includeSpecials,
    includeDownloaded,
  });

  const items = data?.items || [];
  const counts = data?.counts || { episodes: 0, movies: 0, total: 0 };
  const errors = data?.errors || [];

  function shiftMonth(delta) {
    setCursor((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + delta);
      return next;
    });
  }

  function goToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setCursor(d);
  }

  const monthLabel = `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const icsHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("kind", kind);
    params.set("include_unmonitored", includeUnmonitored ? "true" : "false");
    params.set("include_specials", includeSpecials ? "true" : "false");
    params.set("include_downloaded", includeDownloaded ? "true" : "false");
    return `/api/calendar/feed.ics?${params.toString()}`;
  }, [kind, includeUnmonitored, includeSpecials, includeDownloaded]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CalendarDaysIcon className="size-6" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Upcoming episodes and movie releases from your library.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href={icsHref}
                download="panelarr.ics"
                title="Download an iCalendar feed (subscribe in your calendar app)"
              />
            }
          >
            <DownloadIcon className="mr-1.5 size-3.5" />
            ICS
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <div className="flex items-center rounded-md border bg-card">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-r-none"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <div className="border-x px-3 py-1 text-sm font-medium tabular-nums">
              {monthLabel}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-l-none"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={kind === "all"}
              onClick={() => setKind("all")}
              label={`All${data ? ` · ${counts.total}` : ""}`}
            />
            <FilterChip
              active={kind === "episodes"}
              onClick={() => setKind("episodes")}
              icon={TvIcon}
              label={`Episodes${data ? ` · ${counts.episodes}` : ""}`}
            />
            <FilterChip
              active={kind === "movies"}
              onClick={() => setKind("movies")}
              icon={FilmIcon}
              label={`Movies${data ? ` · ${counts.movies}` : ""}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={includeDownloaded}
                onCheckedChange={setIncludeDownloaded}
              />
              Show downloaded
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={includeUnmonitored}
                onCheckedChange={setIncludeUnmonitored}
              />
              Include unmonitored
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={includeSpecials}
                onCheckedChange={setIncludeSpecials}
              />
              Include specials
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Errors (partial fetch failures) */}
      {errors.length > 0 && (
        <Alert variant="warning">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Some sources couldn&apos;t be reached</AlertTitle>
          <AlertDescription>
            {errors.map((e) => `${e.source}: ${e.message}`).join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-8" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Failed to load calendar</AlertTitle>
          <AlertDescription>{error?.message || "Unknown error"}</AlertDescription>
        </Alert>
      ) : (
        <AgendaList items={items} today={today} />
      )}
    </div>
  );
}
