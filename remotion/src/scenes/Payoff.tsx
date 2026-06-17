import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { Stage, HebrewLine } from "../components/Stage";
import { COLORS } from "../theme";

export const Payoff: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // tabs collapse inward
  const collapse = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: "clamp" });
  // card appears
  const cardS = spring({ frame: frame - 36, fps, config: { damping: 200 } });
  // text
  const ts = spring({ frame: frame - 54, fps, config: { damping: 200 } });

  return (
    <Stage>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const radius = (1 - collapse) * 700 + 40;
        const x = 540 + Math.cos(angle) * radius - 130;
        const y = 960 + Math.sin(angle) * radius * 0.9 - 80;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: 260,
              height: 160,
              background: "#0F1A2D",
              border: `1px solid ${COLORS.inkLine}`,
              borderTop: `3px solid ${COLORS.blueDeep}`,
              borderRadius: 6,
              opacity: 1 - collapse,
              transform: `rotate(${(i - 5) * 8 * (1 - collapse)}deg) scale(${1 - collapse * 0.6})`,
            }}
          />
        );
      })}

      {/* clean card */}
      <div
        style={{
          position: "absolute",
          left: 240,
          top: 760,
          width: 600,
          height: 380,
          background: COLORS.card,
          borderRadius: 20,
          opacity: cardS,
          transform: `scale(${0.92 + cardS * 0.08})`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          padding: 32,
          direction: "rtl",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.teal})` }} />
          <div style={{ fontFamily: '"Heebo"', fontWeight: 800, fontSize: 22, color: COLORS.cardInk }}>ReLex</div>
        </div>
        <div style={{ marginTop: 22, height: 14, width: "85%", background: "#E5EAF0", borderRadius: 4 }} />
        <div style={{ marginTop: 12, height: 14, width: "70%", background: "#E5EAF0", borderRadius: 4 }} />
        <div style={{ marginTop: 12, height: 14, width: "78%", background: "#E5EAF0", borderRadius: 4 }} />
        <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
          <div style={{ padding: "8px 14px", background: "#E6F5F0", color: COLORS.teal, fontFamily: '"Heebo"', fontWeight: 700, fontSize: 14, borderRadius: 999 }}>פסיקה</div>
          <div style={{ padding: "8px 14px", background: "#E6F0FA", color: COLORS.blueDeep, fontFamily: '"Heebo"', fontWeight: 700, fontSize: 14, borderRadius: 999 }}>חקיקה</div>
          <div style={{ padding: "8px 14px", background: "#F1F4F7", color: COLORS.mutedDeep, fontFamily: '"Heebo"', fontWeight: 700, fontSize: 14, borderRadius: 999 }}>מאמרים</div>
        </div>
      </div>

      <div style={{ position: "absolute", right: 80, top: 280, width: 920, opacity: ts, transform: `translateY(${(1 - ts) * 20}px)` }}>
        <HebrewLine size={72} weight={500} color={COLORS.muted}>
          מהכאוס
        </HebrewLine>
        <HebrewLine size={92} weight={800} color={COLORS.light}>
          למחקר משפטי
        </HebrewLine>
        <HebrewLine size={92} weight={800} color={COLORS.teal}>
          מסודר.
        </HebrewLine>
      </div>
    </Stage>
  );
};

export const PAYOFF_DURATION = 100;
