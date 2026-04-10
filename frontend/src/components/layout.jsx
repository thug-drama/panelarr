import { Suspense } from "react";
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
import { useVersionCheck } from "@/hooks/use-api";
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

function UpdateBadge() {
  const { data } = useVersionCheck();
  if (!data?.update_available) return null;
  return (
    <a
      href={data.release_url || "https://github.com/thug-drama/panelarr/releases"}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-2 flex items-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20 group-data-[collapsible=icon]:hidden"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
      v{data.latest} available
    </a>
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
          <UserSection />
          <UpdateBadge />
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
