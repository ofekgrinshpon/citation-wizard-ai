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
        const x = 60 + col * 380 + (row % 2) * 50;
        const y = 80 + row * 200;
        const rot = (i % 2 === 0 ? -1 : 1) * (2 + (i % 4));
        const opacity = interpolate(s, [0, 1], [0, 0.65 + (i % 5) * 0.05]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y - (1 - s) * 60,
              width: 360,
              height: 180,
              background: "#0F1A2D",
              border: `1px solid ${COLORS.inkLine}`,
              borderTop: `4px solid ${COLORS.blueDeep}`,
              borderRadius: 8,
              padding: 20,
              opacity,
              transform: `rotate(${rot}deg)`,
              boxShadow: "0 14px 36px rgba(11,18,32,0.45)",
              direction: "rtl",
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <span style={{ width: 11, height: 11, borderRadius: 6, background: "#E15B5B" }} />
              <span style={{ width: 11, height: 11, borderRadius: 6, background: "#E0A23C" }} />
              <span style={{ width: 11, height: 11, borderRadius: 6, background: COLORS.teal }} />
            </div>
            <div
              style={{
                fontFamily: '"Heebo", sans-serif',
                fontSize: 24,
                color: COLORS.light,
                fontWeight: 700,
                direction: "rtl",
                textAlign: "right",
              }}
            >
              {label}
            </div>
            <div
              style={{
                marginTop: 16,
                height: 6,
                width: "70%",
                background: COLORS.inkLine,
                borderRadius: 3,
              }}
            />
            <div
              style={{
                marginTop: 8,
                height: 6,
                width: "50%",
                background: COLORS.inkLine,
                borderRadius: 3,
              }}
            />
          </div>
        );
      })}

      {/* darken overlay over tabs */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(11,32,60,0.35) 50%, rgba(11,32,60,0.85) 100%)",
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
