const BRAND = "#6366f1";

function LogoMark({ size }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="12" fill={BRAND} />
      <rect x="8" y="8" width="22" height="22" rx="4" fill="white" opacity="0.35" />
      <rect x="34" y="8" width="22" height="22" rx="4" fill="white" opacity="0.9" />
      <rect x="8" y="34" width="22" height="22" rx="4" fill="white" opacity="0.35" />
      <rect x="34" y="34" width="22" height="22" rx="4" fill="white" opacity="0.35" />
    </svg>
  );
}

const SIZES = {
  sm: { mark: 24, font: 0, tagline: false },
  md: { mark: 32, font: 18, tagline: false },
  lg: { mark: 56, font: 40, tagline: true },
};

export default function Logo({ size = "md", showTagline = false }) {
  const cfg = SIZES[size] || SIZES.md;
  const shouldShowTagline = showTagline || cfg.tagline;

  if (size === "sm") {
    return <LogoMark size={cfg.mark} />;
  }

  return (
    <div className="flex items-center gap-3">
      <LogoMark size={cfg.mark} />
      <div className="flex flex-col">
        <span
          className="font-extrabold leading-none"
          style={{ fontSize: cfg.font }}
        >
          panel
          <span style={{ color: BRAND }}>arr</span>
        </span>
        {shouldShowTagline && (
          <span className="mt-1 font-mono text-[10px] text-muted-foreground leading-tight">
            homelab media control center
          </span>
        )}
      </div>
    </div>
  );
}
