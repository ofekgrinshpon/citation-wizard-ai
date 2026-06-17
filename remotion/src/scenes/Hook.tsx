import React from "react";
import { useCurrentFrame, AbsoluteFill, interpolate, spring, useVideoConfig } from "remotion";
import { Stage, HebrewLine } from "../components/Stage";
import { COLORS } from "../theme";

const TAB_LABELS = [
  "פס״ד 1234/00", "מאמר משפטי", "תקדים", "חקיקה ראשית",
  "הערת שוליים 17", "פסקה 42", "פס״ד 5678/00", "ספרות אקדמית",
  "תקנות", "פרוטוקול דיון", "חוות דעת", "מאמר ביקורת",
  "פס״ד 9101/00", "תקדים מנחה", "סעיף 8(ב)", "פס״ד 2233/00",
];

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Stage>
      {/* tab cascade */}
      {TAB_LABELS.map((label, i) => {
        const delay = i * 3;
        const s = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 80 + col * 280 + (row % 2) * 40;
        const y = 120 + row * 150;
        const rot = (i % 2 === 0 ? -1 : 1) * (2 + (i % 4));
        const opacity = interpolate(s, [0, 1], [0, 0.55 + (i % 5) * 0.05]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y - (1 - s) * 60,
              width: 260,
              height: 130,
              background: "#0F1A2D",
              border: `1px solid ${COLORS.inkLine}`,
              borderTop: `3px solid ${COLORS.blueDeep}`,
              borderRadius: 6,
              padding: 14,
              opacity,
              transform: `rotate(${rot}deg)`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
              direction: "rtl",
            }}
          >
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#E15B5B" }} />
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#E0A23C" }} />
              <span style={{ width: 8, height: 8, borderRadius: 4, background: COLORS.teal }} />
            </div>
            <div
              style={{
                fontFamily: '"Heebo", sans-serif',
                fontSize: 18,
                color: COLORS.muted,
                fontWeight: 500,
                direction: "rtl",
                textAlign: "right",
              }}
            >
              {label}
            </div>
            <div
              style={{
                marginTop: 12,
                height: 4,
                width: "70%",
                background: COLORS.inkLine,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                marginTop: 6,
                height: 4,
                width: "50%",
                background: COLORS.inkLine,
                borderRadius: 2,
              }}
            />
          </div>
        );
      })}

      {/* darken overlay over tabs */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(11,18,32,0.4) 50%, rgba(11,18,32,0.95) 100%)",
        }}
      />

      {/* headline */}
      <div style={{ position: "absolute", right: 80, bottom: 320, width: 920 }}>
        {(() => {
          const s = spring({ frame: frame - 24, fps, config: { damping: 200 } });
          const u = interpolate(frame - 60, [0, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div style={{ opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
              <HebrewLine size={92} weight={800}>
                מחקר משפטי
              </HebrewLine>
              <HebrewLine size={92} weight={800}>
                לא צריך להיראות
              </HebrewLine>
              <HebrewLine size={92} weight={800} color={COLORS.teal}>
                <span style={{ position: "relative", display: "inline-block" }}>
                  ככה.
                  <span
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: -10,
                      height: 6,
                      width: `${u * 100}%`,
                      background: COLORS.teal,
                      borderRadius: 3,
                    }}
                  />
                </span>
              </HebrewLine>
            </div>
          );
        })()}
      </div>
    </Stage>
  );
};
