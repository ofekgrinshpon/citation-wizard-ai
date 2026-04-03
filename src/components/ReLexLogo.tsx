interface ReLexLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export function ReLexLogo({ className = "", size = 40, showText = true }: ReLexLogoProps) {
  const textScale = size / 40;
  const width = showText ? size * 3.2 : size;
  const height = size * 1.2;

  return (
    <svg
      viewBox={showText ? "0 0 200 60" : "60 -10 80 60"}
      width={width}
      height={height}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Text: ReLex */}
      {showText && (
        <text
          x="10"
          y="46"
          fontFamily="'Inter', 'Heebo', sans-serif"
          fontWeight="700"
          fontSize="42"
          fill="#3498db"
          letterSpacing="-1"
        >
          ReLex
        </text>
      )}

      {/* Speech bubble icon */}
      <g transform="translate(95, -6)">
        {/* Bubble body */}
        <rect x="0" y="0" width="22" height="18" rx="4" ry="4" fill="#1abc9c" />
        {/* Bubble tail */}
        <polygon points="4,18 10,24 12,18" fill="#1abc9c" />
        {/* Open top-right corner effect - gap */}
        <rect x="16" y="-1" width="8" height="6" fill="transparent" />
      </g>

      {/* Curved arrow from 'x' area to bubble top-right */}
      <path
        d="M 152 38 C 158 38 164 30 164 18 C 164 6 156 -2 144 -4 L 144 -4"
        fill="none"
        stroke="#3498db"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <polygon points="144,-8 138,-2 144,0" fill="#3498db" />
    </svg>
  );
}

/** Squared icon version for favicon / add-in */
export function ReLexIcon({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width="64" height="64" rx="12" fill="#3498db" />

      {/* Speech bubble */}
      <g transform="translate(14, 12)">
        <rect x="0" y="0" width="28" height="22" rx="5" ry="5" fill="#1abc9c" />
        <polygon points="5,22 12,30 15,22" fill="#1abc9c" />
      </g>

      {/* Curved arrow */}
      <path
        d="M 46 40 C 52 36 54 26 50 18 C 46 10 40 8 34 10"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polygon points="34,6 30,12 36,12" fill="white" />
    </svg>
  );
}
