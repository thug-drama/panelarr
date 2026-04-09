import { useLocation, Outlet } from "react-router-dom";

import Logo from "@/components/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { SetupProvider, WIZARD_STEPS } from "@/hooks/use-setup";

const STEP_LABELS = [
  "Welcome",
  "System",
  "Auth",
  "Discover",
  "Services",
  "Notifications",
  "Thresholds",
  "Done",
];

function WizardShell() {
  const { pathname } = useLocation();
  const currentIndex = WIZARD_STEPS.indexOf(pathname);
  const stepNumber = Math.max(0, currentIndex);
  const progressValue = WIZARD_STEPS.length > 1
    ? Math.round((stepNumber / (WIZARD_STEPS.length - 1)) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted/40 to-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        {/* Logo / header */}
        <div className="flex flex-col items-center gap-2">
          <Logo size="lg" />
          <p className="text-sm text-muted-foreground">Setup Wizard</p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progressValue} className="gap-0">
            <ProgressTrack className="h-2">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>

          {/* Step dots */}
          <div className="flex items-center justify-between px-0.5">
            {STEP_LABELS.map((label, i) => {
              const isCompleted = i < stepNumber;
              const isCurrent = i === stepNumber;
              return (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div
                    className={[
                      "size-2 rounded-full transition-colors",
                      isCompleted ? "bg-primary" : isCurrent ? "bg-primary/70" : "bg-muted-foreground/30",
                    ].join(" ")}
                  />
                  <span
                    className={[
                      "text-[10px] hidden sm:block transition-colors",
                      isCurrent ? "text-foreground font-medium" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content card */}
        <Card>
          <CardContent className="p-6 sm:p-8">
            <Outlet />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Step {stepNumber + 1} of {WIZARD_STEPS.length}
        </p>
      </div>
    </div>
  );
}

export default function WizardLayout() {
  return (
    <SetupProvider>
      <WizardShell />
    </SetupProvider>
  );
}
