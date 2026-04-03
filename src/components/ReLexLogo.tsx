import relexLogo from "/relex-logo.png";

interface ReLexLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export function ReLexLogo({ className = "", size = 40, showText = true }: ReLexLogoProps) {
  return (
    <img
      src={relexLogo}
      alt="ReLex"
      height={size}
      style={{ height: `${size}px`, width: "auto" }}
      className={className}
    />
  );
}

/** Squared icon version for favicon / add-in */
export function ReLexIcon({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={relexLogo}
      alt="ReLex"
      height={size}
      style={{ height: `${size}px`, width: "auto" }}
      className={className}
    />
  );
}
