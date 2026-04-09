"use client";;
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@/lib/utils";

export function Label(
  {
    className,
    render,
    ...props
  }
) {
  const defaultProps = {
    className: cn(
      "inline-flex items-center gap-2 font-medium text-base/4.5 text-foreground sm:text-sm/4",
      className
    ),
    "data-slot": "label",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps(defaultProps, props),
    render,
  });
}
