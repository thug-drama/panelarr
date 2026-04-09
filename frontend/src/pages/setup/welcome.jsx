import { useNavigate } from "react-router-dom";
import { CheckIcon, ContainerIcon, DownloadIcon, MonitorIcon, ShieldIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

const WIZARD_FEATURES = [
  { icon: MonitorIcon, text: "Check your system is ready to run Panelarr" },
  { icon: ShieldIcon, text: "Configure authentication to secure your dashboard" },
  { icon: ContainerIcon, text: "Detect running media containers automatically" },
  { icon: DownloadIcon, text: "Connect Sonarr, Radarr, and download clients" },
  { icon: CheckIcon, text: "Set notification and threshold preferences" },
];

export default function SetupWelcome() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Welcome to Panelarr</h2>
        <p className="text-sm text-muted-foreground">
          This wizard will guide you through setting up your media server control center.
          It only takes a few minutes to get from zero to a fully working dashboard.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          What we will set up
        </p>
        <ul className="space-y-2">
          {WIZARD_FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={() => navigate("/setup/system-check")}>
          Get Started
        </Button>
      </div>
    </div>
  );
}
