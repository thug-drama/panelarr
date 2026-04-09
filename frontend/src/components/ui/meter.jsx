"use client";;
import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { cn } from "@/lib/utils";

export function Meter(
  {
    className,
    children,
    ...props
  }
) {
  return (
    <MeterPrimitive.Root className={cn("flex w-full flex-col gap-2", className)} {...props}>
      {children ? (
        children
      ) : (
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      )}
    </MeterPrimitive.Root>
  );
}

export function MeterLabel(
  {
    className,
    ...props
  }
) {
  return (
    <MeterPrimitive.Label
      className={cn("font-medium text-foreground text-sm", className)}
      data-slot="meter-label"
      {...props} />
  );
}

export function MeterTrack(
  {
    className,
    ...props
  }
) {
  return (
    <MeterPrimitive.Track
      className={cn("block h-2 w-full overflow-hidden bg-input", className)}
      data-slot="meter-track"
      {...props} />
  );
}

export function MeterIndicator(
  {
    className,
    ...props
  }
) {
  return (
    <MeterPrimitive.Indicator
      className={cn("bg-primary transition-all duration-500", className)}
      data-slot="meter-indicator"
      {...props} />
  );
}

export function MeterValue(
  {
    className,
    ...props
  }
) {
  return (
    <MeterPrimitive.Value
      className={cn("text-foreground text-sm tabular-nums", className)}
      data-slot="meter-value"
      {...props} />
  );
}

export { MeterPrimitive };
