import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BoxIcon,
  CalendarIcon,
  DownloadIcon,
  FilmIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,

  SettingsIcon,
  SunIcon,
  TvIcon,
  XIcon,
} from "lucide-react";

import Logo from "@/components/logo";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSelfUpdate, useVersionCheck } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboardIcon, label: "Dashboard" },
  { to: "/movies", icon: FilmIcon, label: "Movies" },
  { to: "/shows", icon: TvIcon, label: "Shows" },
  { to: "/calendar", icon: CalendarIcon, label: "Calendar" },
  { to: "/containers", icon: BoxIcon, label: "Containers" },
  { to: "/downloads", icon: DownloadIcon, label: "Downloads" },

  { to: "/settings", icon: SettingsIcon, label: "Settings" },
];

const ROUTE_LABELS = {
  "/": "Dashboard",
  "/movies": "Movies",
  "/shows": "Shows",
  "/calendar": "Calendar",
  "/containers": "Containers",
  "/downloads": "Downloads",

  "/settings": "Settings",
};

const THEME_ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

const THEME_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function VersionLabel() {
  const { data } = useVersionCheck();
  const version = data?.current ?? "...";
  return (
    <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      v{version}
    </span>
  );
}

function UpdateCard() {
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
      // Container may die before responding, that's expected
    }
    // Poll health until the new container is up
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
    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(poll), 120_000);
  }

  return (
    <div className="mx-2 mb-1 group-data-[collapsible=icon]:hidden">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0 mt-1">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            <div>
              <p className="text-xs font-medium">Update available</p>
              <p className="text-[11px] text-muted-foreground">
                v{data.latest} ready to install
              </p>
            </div>
          </div>
          {!isUpdating && (
            <button
              onClick={() => setIsDismissed(true)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? (
            <>
              <Spinner className="size-3" />
              Updating...
            </>
          ) : (
            "Update now"
          )}
        </Button>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { mode, cycleMode } = useTheme();
  const Icon = THEME_ICONS[mode];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={cycleMode}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="right">
        Theme: {THEME_LABELS[mode]}
      </TooltipPopup>
    </Tooltip>
  );
}

function UserSection() {
  const { mode, user, logout } = useAuth();

  if (mode === "none") return null;
  if (!user && mode !== "basic") return null;

  return (
    <div className="flex items-center justify-between px-2 py-1 group-data-[collapsible=icon]:hidden">
      {user && (
        <span className="truncate text-xs text-muted-foreground">{user}</span>
      )}
      {mode === "basic" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={logout}
              />
            }
          >
            <LogOutIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="right">Sign out</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

export default function Layout() {
  const location = useLocation();
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Panelarr">
                <Logo size="md" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <NavLink to={item.to} end={item.to === "/"}>
                      {({ isActive }) => (
                        <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UpdateCard />
          <Separator className="group-data-[collapsible=icon]:hidden" />
          <UserSection />
          <div className="flex items-center justify-between px-2 py-1">
            <VersionLabel />
            <ThemeToggle />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-foreground">
            {ROUTE_LABELS[location.pathname] || Object.entries(ROUTE_LABELS).find(([path]) => path !== "/" && location.pathname.startsWith(path))?.[1] || ""}
          </span>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Suspense fallback={<div className="flex h-64 items-center justify-center"><Spinner className="size-8" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
