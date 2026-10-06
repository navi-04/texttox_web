/** Small monochrome icons: 2px strokes with round caps and joins, so nothing has a sharp edge. */
type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

/** The app logo (public/logo.png, a black mark on white) on a rounded white tile. The picture has a wide margin, so it is zoomed to fill the tile. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="x-logo" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ position: "absolute", left: "50%", top: "50%", width: "130%", height: "130%", maxWidth: "none", transform: "translate(-50%, -50%)" }}
      />
    </span>
  );
}

export const Back = ({ size = 22 }: P) => (
  <svg {...base(size)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const Chevron = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const Flag = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);

export const ArrowUp = ({ size = 22 }: P) => (
  <svg {...base(size)} strokeWidth={2.6}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const Lock = ({ size = 24 }: P) => (
  <svg {...base(size)}>
    <rect x="5" y="11" width="14" height="9" rx="3" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </svg>
);

export const Shuffle = ({ size = 24 }: P) => (
  <svg {...base(size)}>
    <path d="M3 7h3.5a4 4 0 013.2 1.6l4.6 6.8a4 4 0 003.2 1.6H21M3 17h3.5a4 4 0 003-1.4M14 8.4A4 4 0 0117 7h4M18 4l3 3-3 3M18 14l3 3-3 3" />
  </svg>
);

export const Group = ({ size = 24 }: P) => (
  <svg {...base(size)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0111 0M16 5.2a3.2 3.2 0 010 5.6M17.5 14a5.5 5.5 0 013.5 5" />
  </svg>
);

export const Person = ({ size = 28 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20a7 7 0 0114 0" />
  </svg>
);
