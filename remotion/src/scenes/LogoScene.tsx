import React from "react";
import { useCurrentFrame, spring, useVideoConfig, interpolate, Img } from "remotion";
import { Stage, HebrewLine } from "../components/Stage";
import { COLORS } from "../theme";
import relexLogo from "../assets/relex-logo.png";

export const LogoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 20, stiffness: 160 } });
  const sweep = interpolate(frame, [20, 60], [-100, 200], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line1 = spring({ frame: frame - 30, fps, config: { damping: 200 } });
  const line2 = spring({ frame: frame - 44, fps, config: { damping: 200 } });
  const line3 = spring({ frame: frame - 64, fps, config: { damping: 200 } });

  return (
    <Stage>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 560,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
        }}
      >
        <div
          style={{
            width: 680,
            height: 320,
            position: "relative",
            opacity: s,
            transform: `scale(${0.9 + s * 0.1})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: COLORS.card,
              borderRadius: 24,
              padding: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
              overflow: "hidden",
            }}
          >
            <Img src={relexLogo} style={{ width: "92%", height: "92%", objectFit: "contain" }} />
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${sweep}%`,
                width: 120,
                background: "linear-gradient(90deg, transparent, rgba(48,169,140,0.45), rgba(52,152,219,0.45), transparent)",
                transform: "skewX(-20deg)",
              }}
            />
          </div>
        </div>

        <div
          style={{
            opacity: line2,
            transform: `translateY(${(1 - line2) * 20}px)`,
            textAlign: "center",
          }}
        >
          <HebrewLine size={44} weight={700} color={COLORS.light} align="center">
            העוזר למחקר משפטי, מקורות ואזכורים
          </HebrewLine>
        </div>

        <div
          style={{
            opacity: line3,
            transform: `translateY(${(1 - line3) * 20}px)`,
            padding: "12px 28px",
            border: `1.5px solid ${COLORS.teal}`,
            borderRadius: 999,
          }}
        >
          <HebrewLine size={28} weight={700} color={COLORS.teal} align="center">
            בקרוב
          </HebrewLine>
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 80, textAlign: "center", opacity: line1 }}>
        <div style={{ fontFamily: '"Heebo"', fontSize: 22, color: COLORS.muted, letterSpacing: "0.3em" }}>
          relexlm.com
        </div>
      </div>
    </Stage>
  );
};

export const LOGO_DURATION = 110;
