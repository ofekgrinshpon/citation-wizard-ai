import React from "react";
import { useCurrentFrame, AbsoluteFill, Sequence, interpolate, spring, useVideoConfig } from "remotion";
import { Stage, HebrewLine } from "../components/Stage";
import { COLORS } from "../theme";

const BEAT = 26;

const Vignette: React.FC<{ caption: string; children: React.ReactNode; warn?: boolean }> = ({
  caption,
  children,
  warn,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ direction: "rtl" }}>
      <div style={{ opacity: s, position: "absolute", inset: 0 }}>{children}</div>
      <div
        style={{
          position: "absolute",
          right: 80,
          bottom: 240,
          opacity: interpolate(frame, [4, 12], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        <HebrewLine size={72} weight={800} color={warn ? "#E15B5B" : COLORS.light}>
          {caption}
        </HebrewLine>
      </div>
    </AbsoluteFill>
  );
};

const PdfFan: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: 7 }).map((_, i) => {
        const rot = (i - 3) * 6;
        const off = (i - 3) * 40;
        const t = Math.min(1, frame / 14);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 540 - 200 + off,
              top: 700 + Math.abs(i - 3) * 10 - t * 30,
              width: 400,
              height: 540,
              background: "#F1F4F7",
              border: `1px solid #C8D0DA`,
              borderRadius: 6,
              transform: `rotate(${rot * t}deg)`,
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              padding: 24,
              direction: "rtl",
            }}
          >
            <div style={{ fontFamily: '"Heebo"', fontSize: 14, color: "#5A6B82" }}>PDF</div>
            <div style={{ marginTop: 12, fontFamily: '"Heebo"', fontWeight: 700, fontSize: 20, color: "#1F2A3A" }}>
              פס״ד 0000/00
            </div>
            {Array.from({ length: 18 }).map((_, k) => (
              <div
                key={k}
                style={{
                  marginTop: 10,
                  height: 6,
                  width: `${60 + ((k * 13) % 35)}%`,
                  background: "#D7DEE8",
                  borderRadius: 3,
                  marginRight: k % 3 === 0 ? 0 : 12,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

const Footnotes: React.FC = () => {
  const frame = useCurrentFrame();
  const scroll = interpolate(frame, [0, BEAT], [0, -800]);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 200 + scroll,
          width: 840,
          direction: "rtl",
        }}
      >
        {Array.from({ length: 28 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
            <span style={{ fontFamily: '"Heebo"', color: COLORS.teal, fontSize: 22, fontWeight: 700, minWidth: 36 }}>
              {i + 1}.
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ height: 10, width: `${55 + ((i * 11) % 35)}%`, background: COLORS.inkLine, borderRadius: 3 }} />
              <div style={{ height: 10, width: `${35 + ((i * 7) % 50)}%`, background: COLORS.inkLine, borderRadius: 3, marginTop: 8, opacity: 0.6 }} />
            </div>
          </div>
        ))}
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,18,32,1) 0%, transparent 20%, transparent 70%, rgba(11,18,32,1) 100%)" }} />
    </div>
  );
};

const Article: React.FC = () => {
  const frame = useCurrentFrame();
  const scroll = interpolate(frame, [0, BEAT], [0, -600]);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", right: 140, top: 180 + scroll, width: 800, direction: "rtl" }}>
        {Array.from({ length: 40 }).map((_, i) => {
          const highlight = i % 7 === 3 && frame > 8;
          return (
            <div
              key={i}
              style={{
                height: 14,
                width: `${70 + ((i * 9) % 25)}%`,
                background: highlight ? `${COLORS.warn}aa` : COLORS.inkLine,
                borderRadius: 3,
                marginBottom: 14,
              }}
            />
          );
        })}
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,18,32,1) 0%, transparent 20%, transparent 70%, rgba(11,18,32,1) 100%)" }} />
    </div>
  );
};

const CitationCheck: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = 0.5 + 0.5 * Math.sin(frame / 2);
  const typed = Math.floor(interpolate(frame, [4, BEAT], [0, 38], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const text = "בג״ץ 0000/00 פלוני נ׳ אלמוני (אר״ש 0000)";
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          right: 80,
          top: 700,
          width: 920,
          padding: 32,
          background: "#0F1A2D",
          border: `1px solid ${COLORS.inkLine}`,
          borderRadius: 12,
          direction: "rtl",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "#E15B5B",
              opacity: pulse,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontFamily: '"Heebo"',
              fontWeight: 800,
            }}
          >
            !
          </span>
          <span style={{ fontFamily: '"Heebo"', color: "#E15B5B", fontSize: 22, fontWeight: 700 }}>
            מקור לא מאומת
          </span>
        </div>
        <div
          style={{
            fontFamily: '"Heebo"',
            fontSize: 30,
            color: COLORS.light,
            direction: "rtl",
            textAlign: "right",
            letterSpacing: "0.01em",
          }}
        >
          {text.slice(0, typed)}
          <span style={{ opacity: pulse }}>|</span>
        </div>
      </div>
    </div>
  );
};

export const Chaos: React.FC = () => {
  return (
    <Stage>
      <Sequence from={0} durationInFrames={BEAT}>
        <Vignette caption="עוד פסיקה">
          <PdfFan />
        </Vignette>
      </Sequence>
      <Sequence from={BEAT} durationInFrames={BEAT}>
        <Vignette caption="עוד הערת שוליים">
          <Footnotes />
        </Vignette>
      </Sequence>
      <Sequence from={BEAT * 2} durationInFrames={BEAT}>
        <Vignette caption="עוד מאמר">
          <Article />
        </Vignette>
      </Sequence>
      <Sequence from={BEAT * 3} durationInFrames={BEAT}>
        <Vignette caption="ועוד בדיקה אם המקור בכלל נכון" warn>
          <CitationCheck />
        </Vignette>
      </Sequence>
    </Stage>
  );
};

export const CHAOS_DURATION = BEAT * 4;
