"use client";;
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";

export function Progress(
  {
    className,
    children,
    ...props
  }
) {
  return (
    <ProgressPrimitive.Root
      className={cn("flex w-full flex-col gap-2", className)}
      data-slot="progress"
      {...props}>
      {children ? (
        children
      ) : (
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      )}
    </ProgressPrimitive.Root>
  );
}

export function ProgressLabel(
  {
    className,
    ...props
  }
) {
  return (
    <ProgressPrimitive.Label
      className={cn("font-medium text-sm", className)}
      data-slot="progress-label"
      {...props} />
  );
}

export function ProgressTrack(
  {
    className,
    ...props
  }
) {
  return (
    <ProgressPrimitive.Track
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-input", className)}
      data-slot="progress-track"
      {...props} />
  );
}

export function ProgressIndicator(
  {
    className,
    ...props
  }
) {
  return (
    <ProgressPrimitive.Indicator
      className={cn("bg-primary transition-all duration-500", className)}
      data-slot="progress-indicator"
      {...props} />
  );
}

export function ProgressValue(
  {
    className,
    ...props
  }
) {
  return (
    <ProgressPrimitive.Value
      className={cn("text-sm tabular-nums", className)}
      data-slot="progress-value"
      {...props} />
  );
}

export { ProgressPrimitive };
