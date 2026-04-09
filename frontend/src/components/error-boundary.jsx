import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router-dom";
import { AlertTriangleIcon, HomeIcon, RotateCcwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = "Something went wrong";
  let description = "An unexpected error occurred. Please try again.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      description = "The page you're looking for doesn't exist.";
    } else {
      title = `Error ${error.status}`;
      description = error.statusText || description;
    }
  } else if (error instanceof Error) {
    description = error.message;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="error">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            <RotateCcwIcon className="size-4" />
            Reload
          </Button>
          <Button
            onClick={() => navigate("/")}
          >
            <HomeIcon className="size-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RootErrorBoundary() {
  const error = useRouteError();

  let description = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    description = `${error.status}: ${error.statusText}`;
  } else if (error instanceof Error) {
    description = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md space-y-4 text-center">
        <AlertTriangleIcon className="mx-auto size-12 text-destructive" />
        <h1 className="text-2xl font-semibold">Panelarr Error</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button
          onClick={() => {
            window.location.href = "/";
          }}
        >
          <HomeIcon className="size-4" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
