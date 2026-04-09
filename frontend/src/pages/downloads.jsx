import { useState } from "react";
import { BanIcon, RefreshCwIcon, ShieldCheckIcon, TrashIcon } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useBlocklistDownload,
  useBlocklistWarnings,
  useDeleteDownload,
  useDownloads,
  useDownloadStats,
  useImportScan,
} from "@/hooks/use-api";
import { cn, formatSize } from "@/lib/utils";

function DownloadTable({ items }) {
  const deleteItem = useDeleteDownload();
  const blocklistItem = useBlocklistDownload();
  const importScan = useImportScan();

  if (!items || items.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No downloads in queue
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="hidden sm:table-cell">Source</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead className="hidden md:table-cell">Size</TableHead>
          <TableHead className="hidden lg:table-cell">ETA</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((dl) => (
          <TableRow
            key={`${dl.app}-${dl.id}`}
            className={cn(dl.warning && "bg-yellow-50/50 dark:bg-yellow-900/10")}
          >
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-sm max-w-xs">{dl.title}</span>
                {dl.warning && dl.warning_text && (
                  <span className="text-xs text-yellow-600 dark:text-yellow-400">
                    {dl.warning_text}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={dl.app === "sonarr" ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {dl.app}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {dl.protocol === "usenet" ? "NZB" : "Torrent"}
                </Badge>
                {(dl.status === "importPending" || dl.status === "importing") && (
                  <Badge variant="info" className="text-[10px]">
                    {dl.status === "importing" ? "importing" : "awaiting import"}
                  </Badge>
                )}
                {dl.warning && (
                  <Badge variant="warning" className="text-[10px]">
                    warn
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2 min-w-24">
                <Progress value={dl.pct} className="flex-1">
                  <ProgressTrack>
                    <ProgressIndicator />
                  </ProgressTrack>
                </Progress>
                <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                  {dl.pct}%
                </span>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
              {formatSize(dl.size)}
            </TableCell>
            <TableCell className="hidden lg:table-cell text-muted-foreground text-sm tabular-nums">
              {dl.time_left || ", "}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                {dl.warning && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Trigger import scan"
                    onClick={() => importScan.mutate(dl.app)}
                    disabled={importScan.isPending}
                  >
                    <RefreshCwIcon className="size-3" />
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="ghost" size="icon" className="size-7" title="Remove from queue" />}>
                    <TrashIcon className="size-3" />
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove Download</AlertDialogTitle>
                      <AlertDialogDescription>
                        Remove &quot;{dl.title}&quot; from the queue?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                      <AlertDialogClose
                        render={<Button variant="destructive" onClick={() => deleteItem.mutate({ source: dl.app, id: dl.id })} />}
                      >
                        Remove
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="ghost" size="icon" className="size-7" title="Blocklist and search new release" />}>
                    <BanIcon className="size-3" />
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Blocklist Release</AlertDialogTitle>
                      <AlertDialogDescription>
                        Blocklist &quot;{dl.title}&quot; and search for a new release?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                      <AlertDialogClose
                        render={<Button variant="destructive" onClick={() => blocklistItem.mutate({ source: dl.app, id: dl.id })} />}
                      >
                        Blocklist
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function Downloads() {
  const { data: downloads, isLoading, error, refetch } = useDownloads();
  const { data: stats } = useDownloadStats();
  const blocklistAll = useBlocklistWarnings();
  const [tab, setTab] = useState("all");

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

  const warningCount = downloads?.filter((d) => d.warning).length ?? 0;
  const downloadingCount = downloads?.filter((d) => d.status === "downloading").length ?? 0;
  const importingItems = downloads?.filter((d) =>
    d.status === "importPending" || d.status === "importing"
  ) ?? [];

  const filtered =
    tab === "all"
      ? downloads
      : tab === "warnings"
        ? downloads?.filter((d) => d.warning)
        : tab === "importing"
          ? importingItems
          : tab === "torrent"
            ? downloads?.filter((d) => d.protocol === "torrent")
            : tab === "usenet"
              ? downloads?.filter((d) => d.protocol === "usenet")
              : downloads?.filter((d) => d.app === tab);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Downloads</h1>
        {warningCount > 0 && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" disabled={blocklistAll.isPending} />}>
              {blocklistAll.isPending && <Spinner className="size-4" />}
              Blocklist All Warnings ({warningCount})
            </AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Blocklist All Warnings</AlertDialogTitle>
                <AlertDialogDescription>
                  This will blocklist {warningCount} items with warnings and search for new releases.
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
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="default">
          {stats?.torrent_active ?? 0} torrents / {stats?.nzb_active ?? 0} NZBs
        </Badge>
        <Badge variant="secondary">{(downloads?.length ?? 0) - downloadingCount} queued</Badge>
        {warningCount > 0 && <Badge variant="warning">{warningCount} warnings</Badge>}
        {stats?.qbittorrent?.configured && stats.qbittorrent.vpn_active !== undefined && (
          <Badge variant={stats.qbittorrent.vpn_active ? "success" : "destructive"}>
            <ShieldCheckIcon className="size-3 mr-1" />
            VPN: {stats.qbittorrent.vpn_active ? (stats.qbittorrent.vpn_interface || "Active") : "Off"}
          </Badge>
        )}
        {stats?.sabnzbd?.configured && stats.sabnzbd.speed && (
          <Badge variant="outline">SAB: {stats.sabnzbd.speed}</Badge>
        )}
        {stats?.qbittorrent?.configured && typeof stats.qbittorrent.active === "number" && (
          <Badge variant="outline">qBit: {stats.qbittorrent.active} active</Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({downloads?.length ?? 0})</TabsTrigger>
          {warningCount > 0 && (
            <TabsTrigger value="warnings">Warnings ({warningCount})</TabsTrigger>
          )}
          {importingItems.length > 0 && (
            <TabsTrigger value="importing">Importing ({importingItems.length})</TabsTrigger>
          )}
          <TabsTrigger value="torrent">Torrents</TabsTrigger>
          <TabsTrigger value="usenet">NZBs</TabsTrigger>
          {(stats?.arr_services ?? ["sonarr", "radarr"]).map((svc) => (
            <TabsTrigger key={svc} value={svc}>
              {svc.charAt(0).toUpperCase() + svc.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              <DownloadTable items={filtered} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
