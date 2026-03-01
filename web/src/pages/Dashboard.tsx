import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import {
  RiCameraLine,
  RiRefreshLine,
  RiLogoutBoxLine,
  RiCalendarLine,
  RiTimeLine,
  RiHardDrive2Line,
  RiSearchLine,
  RiCloseLine,
  RiVideoLine,
  RiAlertLine,
  RiSettings3Line,
} from "@remixicon/react";
import { format, isToday, isYesterday, parseISO, isSameDay } from "date-fns";
import { useNavigate } from "react-router";

interface RecordingEvent {
  id: number;
  device_id: string;
  device_name: string;
  kind: string;
  created_at: string;
  file_path: string;
}

function formatDayHeading(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d, yyyy");
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TimelineSkeletonDay() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-40" />
      <div className="ml-6 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="mt-1 size-2 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { logout, token } = useAuth();
  const navigate = useNavigate();
  const [selectedEvent, setSelectedEvent] = useState<RecordingEvent | null>(
    null,
  );
  const [dateFilter, setDateFilter] = useState<string>("");

  const {
    data: events,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const response = await api.get<RecordingEvent[]>("/events");
      return response.data;
    },
  });

  // Group events by date, optionally filtered
  const groupedEvents = useMemo(() => {
    if (!events) return [];

    const filtered = dateFilter
      ? events.filter((e) =>
          isSameDay(parseISO(e.created_at), parseISO(dateFilter)),
        )
      : events;

    const map = new Map<string, RecordingEvent[]>();
    for (const event of filtered) {
      const day = format(parseISO(event.created_at), "yyyy-MM-dd");
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(event);
    }

    // Already sorted desc from API, preserve order
    return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
  }, [events, dateFilter]);

  const totalCount = events?.length ?? 0;
  const filteredCount = groupedEvents.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2 shrink-0">
            <RiHardDrive2Line className="size-4 text-primary" />
            <span className="text-sm font-semibold tracking-tight">NVR</span>
            <Badge variant="outline" className="hidden sm:inline-flex">
              {isLoading ? "…" : `${totalCount} recordings`}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => refetch()}
              aria-label="Refresh"
            >
              <RiRefreshLine className={isFetching ? "animate-spin" : ""} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("/settings")}
              aria-label="Settings"
            >
              <RiSettings3Line />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              aria-label="Logout"
            >
              <RiLogoutBoxLine />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 space-y-6">
        {/* ── Search / filter bar ──────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="pl-7 w-full"
              aria-label="Filter by date"
            />
          </div>
          {dateFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDateFilter("")}
              className="gap-1 text-muted-foreground"
            >
              <RiCloseLine className="size-3.5" />
              Clear
            </Button>
          )}
          {dateFilter && !isLoading && (
            <span className="text-xs text-muted-foreground ml-1">
              {filteredCount} result{filteredCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* ── States ───────────────────────────────────────────────── */}
        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
            <RiAlertLine className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-medium">Failed to load recordings</p>
              <p className="text-xs text-destructive/80">
                Please check your connection and try again.
              </p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-8">
            <TimelineSkeletonDay />
            <TimelineSkeletonDay />
          </div>
        ) : groupedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <RiCameraLine className="size-10 opacity-20" />
            <p className="text-sm">
              {dateFilter
                ? `No recordings found for ${format(parseISO(dateFilter), "MMMM d, yyyy")}.`
                : "No recordings yet."}
            </p>
            {dateFilter && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDateFilter("")}
              >
                Show all recordings
              </Button>
            )}
          </div>
        ) : (
          /* ── Timeline ─────────────────────────────────────────── */
          <div className="space-y-8">
            {groupedEvents.map(({ day, items }, groupIndex) => (
              <section key={day} aria-label={formatDayHeading(day)}>
                {/* Day heading */}
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <RiCalendarLine className="size-3.5 text-muted-foreground" />
                    <h2 className="text-xs font-semibold text-foreground">
                      {formatDayHeading(day)}
                    </h2>
                  </div>
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {items.length} event{items.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Events list */}
                <ol className="relative ml-1 space-y-0 border-l border-border">
                  {items.map((event) => (
                    <li
                      key={event.id}
                      className="group relative pl-5 pb-5 last:pb-0"
                    >
                      {/* Timeline dot */}
                      <span className="absolute -left-[4.5px] top-3.5 size-2.5 rounded-full border-2 border-background bg-border ring-background group-hover:bg-primary transition-colors duration-150" />

                      {/* Event card */}
                      <div className="ring-foreground/8 bg-card text-card-foreground flex items-start justify-between gap-3 rounded-lg p-3 ring-1 transition-shadow duration-150 hover:ring-foreground/15">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          {/* Top row: name + badge */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium truncate">
                              {event.device_name}
                            </span>
                            <Badge
                              variant="secondary"
                              className="shrink-0 capitalize"
                            >
                              {kindLabel(event.kind)}
                            </Badge>
                          </div>

                          {/* Time + ID row */}
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1 text-[0.65rem]">
                              <RiTimeLine className="size-3" />
                              {format(parseISO(event.created_at), "HH:mm:ss")}
                            </span>
                            <span className="text-[0.6rem] font-mono opacity-50">
                              #{event.id}
                            </span>
                          </div>
                        </div>

                        {/* Action */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedEvent(event)}
                          className="shrink-0"
                        >
                          <RiVideoLine />
                          Play
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>

                {/* Spacer between groups except last */}
                {groupIndex < groupedEvents.length - 1 && (
                  <div className="ml-1 h-3 border-l border-dashed border-border" />
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      {/* ── Video Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={selectedEvent !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setSelectedEvent(null);
        }}
      >
        {selectedEvent && (
          <DialogContent className="max-w-5xl gap-3 p-4">
            <DialogHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <DialogTitle className="truncate">
                    {selectedEvent.device_name}
                  </DialogTitle>
                  <DialogDescription>
                    <span className="capitalize">
                      {kindLabel(selectedEvent.kind)}
                    </span>
                    {" · "}
                    {format(parseISO(selectedEvent.created_at), "PPpp")}
                  </DialogDescription>
                </div>
                <DialogClose
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Close"
                >
                  <RiCloseLine className="size-4" />
                </DialogClose>
              </div>
            </DialogHeader>

            <div className="aspect-video overflow-hidden rounded-lg border border-border bg-black">
              <video
                key={selectedEvent.id}
                controls
                autoPlay
                className="h-full w-full object-contain"
                src={`/api/recordings/${selectedEvent.id}?token=${token}`}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
