import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { Stage, HebrewLine, useEnter } from "../components/Stage";
import { COLORS, GRADIENT } from "../theme";

const SOURCES = [
  { label: "פסיקה", count: 12 },
  { label: "חקיקה", count: 5 },
  { label: "מאמרים", count: 8 },
  { label: "מקורות מאומתים", count: 24 },
  { label: "אזכור אחיד", count: 1 },
];

const QUESTION = "חופש הביטוי בשעת חירום — מה ההלכה?";

export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // headline
  const hs = spring({ frame: frame - 6, fps, config: { damping: 200 } });

  // card
  const cs = spring({ frame: frame - 18, fps, config: { damping: 22, stiffness: 140 } });

  // typing
  const charCount = Math.floor(interpolate(frame - 30, [0, 38], [0, QUESTION.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <Stage>
      <div
        style={{
          position: "absolute",
          right: 80,
          top: 200,
          width: 920,
          opacity: hs,
          transform: `translateY(${(1 - hs) * 30}px)`,
        }}
      >
        <HebrewLine size={64} weight={500} color={COLORS.muted}>
          ReLex
        </HebrewLine>
        <HebrewLine size={80} weight={800} color={COLORS.light} style={{ marginTop: 8 }}>
          עושה סדר במחקר
        </HebrewLine>
        <HebrewLine size={80} weight={800} color={COLORS.light}>
          המשפטי.
        </HebrewLine>
      </div>

      {/* Product card */}
      <div
        style={{
          position: "absolute",
          right: 60,
          top: 620,
          width: 960,
          opacity: cs,
          transform: `translateY(${(1 - cs) * 40}px) scale(${0.96 + cs * 0.04})`,
          background: COLORS.card,
          borderRadius: 20,
          padding: 36,
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
          direction: "rtl",
        }}
      >
        {/* window chrome */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: GRADIENT }} />
            <div style={{ fontFamily: '"Heebo"', fontWeight: 800, fontSize: 22, color: COLORS.cardInk, letterSpacing: "-0.01em" }}>
              ReLex
            </div>
            <div style={{ fontFamily: '"Heebo"', fontWeight: 500, fontSize: 14, color: COLORS.mutedDeep, marginRight: 8 }}>
              עוזר מחקר משפטי
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, background: "#E5EAF0" }} />
            <span style={{ width: 12, height: 12, borderRadius: 6, background: "#E5EAF0" }} />
            <span style={{ width: 12, height: 12, borderRadius: 6, background: "#E5EAF0" }} />
          </div>
        </div>

        {/* search bar */}
        <div
          style={{
            background: "#F1F4F7",
            border: "1px solid #E5EAF0",
            borderRadius: 12,
            padding: "22px 28px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            direction: "rtl",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: GRADIENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontFamily: '"Heebo"',
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            R
          </div>
          <div
            style={{
              flex: 1,
              fontFamily: '"Heebo"',
              fontSize: 26,
              fontWeight: 500,
              color: COLORS.cardInk,
              direction: "rtl",
              textAlign: "right",
            }}
          >
            {QUESTION.slice(0, charCount)}
            <span style={{ opacity: (frame % 20) < 10 ? 1 : 0, color: COLORS.blue }}>|</span>
          </div>
        </div>

        {/* source row */}
        <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap", justifyContent: "flex-start" }}>
          {SOURCES.map((src, i) => {
            const enter = useEnter(72 + i * 5, 16);
            return (
              <div
                key={src.label}
                style={{
                  ...enter,
                  padding: "16px 20px",
                  background: "#F7F9FC",
                  border: "1px solid #E5EAF0",
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  direction: "rtl",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: GRADIENT,
                    display: "inline-block",
                  }}
                />
                <span style={{ fontFamily: '"Heebo"', fontWeight: 700, fontSize: 20, color: COLORS.cardInk }}>
                  {src.label}
                </span>
                <span
                  style={{
                    fontFamily: '"Heebo"',
                    fontWeight: 700,
                    fontSize: 16,
                    color: COLORS.teal,
                    background: "#E6F5F0",
                    padding: "4px 10px",
                    borderRadius: 999,
                  }}
                >
                  {src.count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

export const REVEAL_DURATION = 135;
