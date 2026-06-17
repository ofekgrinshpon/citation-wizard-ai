import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { COLORS } from "../theme";

export const Stage: React.FC<{ children: React.ReactNode; light?: boolean }> = ({
  children,
  light,
}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 120) * 30;
  const bg = light ? COLORS.light : COLORS.ink;
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden", direction: "rtl" }}>
      {!light && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${50 + drift}% ${30 - drift / 2}%, ${COLORS.inkLine} 0%, ${COLORS.ink} 55%, ${COLORS.inkDeep} 100%)`,
          }}
        />
      )}
      {/* hairline grid */}
      <AbsoluteFill
        style={{
          opacity: light ? 0.05 : 0.07,
          backgroundImage: `linear-gradient(${light ? "#0B1220" : "#F1F4F7"} 1px, transparent 1px), linear-gradient(90deg, ${light ? "#0B1220" : "#F1F4F7"} 1px, transparent 1px)`,
          backgroundSize: "120px 120px",
          backgroundPosition: `${drift}px ${-drift}px`,
        }}
      />
      {/* soft orb */}
      {!light && (
        <div
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            right: -200 + drift,
            top: 400 + drift,
            background: `radial-gradient(circle, ${COLORS.blue}22 0%, transparent 60%)`,
            filter: "blur(40px)",
          }}
        />
      )}
      {children}
    </AbsoluteFill>
  );
};

export const HebrewLine: React.FC<{
  children: React.ReactNode;
  size: number;
  weight?: number;
  color?: string;
  align?: "right" | "center" | "left";
  style?: React.CSSProperties;
}> = ({ children, size, weight = 800, color = COLORS.light, align = "right", style }) => (
  <div
    style={{
      fontFamily: '"Heebo", sans-serif',
      fontWeight: weight,
      fontSize: size,
      color,
      direction: "rtl",
      textAlign: align,
      lineHeight: 1.15,
      letterSpacing: "-0.01em",
      ...style,
    }}
  >
    {children}
  </div>
);

export const useEnter = (start: number, duration = 18) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const t = Math.max(0, Math.min(1, local / duration));
  // ease out cubic
  const eased = 1 - Math.pow(1 - t, 3);
  return {
    opacity: eased,
    transform: `translateY(${(1 - eased) * 24}px)`,
    filter: `blur(${(1 - eased) * 8}px)`,
  };
};
