"use client";;
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";

export function Collapsible(
  {
    ...props
  }
) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(
  {
    className,
    ...props
  }
) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn("cursor-pointer", className)}
      data-slot="collapsible-trigger"
      {...props} />
  );
}

export function CollapsiblePanel(
  {
    className,
    ...props
  }
) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0",
        className
      )}
      data-slot="collapsible-panel"
      {...props} />
  );
}

export { CollapsiblePrimitive, CollapsiblePanel as CollapsibleContent };
