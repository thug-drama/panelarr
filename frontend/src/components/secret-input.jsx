import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@/components/ui/input";

export function SecretInput({ value, onChange, placeholder, id, className }) {
  const [isVisible, setIsVisible] = useState(false);
  const isMasked = value?.startsWith("****");

  return (
    <div className="relative">
      <Input
        id={id}
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={isMasked ? "Configured, leave blank to keep" : placeholder}
        className={["pr-10", className].filter(Boolean).join(" ")}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setIsVisible((v) => !v)}
        aria-label={isVisible ? "Hide" : "Show"}
      >
        {isVisible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}
