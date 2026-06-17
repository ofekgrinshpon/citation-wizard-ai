import React from "react";
import { useCurrentFrame, Sequence, interpolate, spring, useVideoConfig, AbsoluteFill } from "remotion";
import { Stage, HebrewLine } from "../components/Stage";
import { COLORS, GRADIENT } from "../theme";

const BEAT = 60;

const CardShell: React.FC<{ children: React.ReactNode; caption: string }> = ({ children, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const cap = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ direction: "rtl" }}>
      <div style={{ position: "absolute", right: 80, top: 200, width: 920, opacity: cap, transform: `translateY(${(1-cap)*20}px)` }}>
        <HebrewLine size={68} weight={800} color={COLORS.light}>
          {caption}
        </HebrewLine>
      </div>
      <div
        style={{
          position: "absolute",
          right: 80,
          top: 460,
          width: 920,
          opacity: s,
          transform: `translateY(${(1 - s) * 40}px)`,
          background: COLORS.card,
          borderRadius: 20,
          padding: 36,
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          direction: "rtl",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

const VerifiedSources: React.FC = () => {
  const frame = useCurrentFrame();
  const items: { tag: string; tagBg: string; tagColor: string; text: string }[] = [
    {
      tag: "פסיקה",
      tagBg: "#E6F5F0",
      tagColor: COLORS.teal,
      text: 'בג"ץ 5016/96 חורב נ\' שר התחבורה, פ"ד נא(4) 1 (1997).',
    },
    {
      tag: "חוק יסוד",
      tagBg: "#E6F0FA",
      tagColor: COLORS.blueDeep,
      text: 'חוק־יסוד: כבוד האדם וחירותו, ס"ח התשנ"ב 150.',
    },
    {
      tag: "חקיקה",
      tagBg: "#E6F0FA",
      tagColor: COLORS.blueDeep,
      text: 'חוק העונשין, התשל"ז–1977, ס"ח 226.',
    },
    {
      tag: "פסיקה",
      tagBg: "#E6F5F0",
      tagColor: COLORS.teal,
      text: 'ע"א 4628/93 מדינת ישראל נ\' אפרופים שיכון ויזום, פ"ד מט(2) 265 (1995).',
    },
    {
      tag: "מאמר",
      tagBg: "#F1F4F7",
      tagColor: COLORS.mutedDeep,
      text: 'מנאל תותרי-ג\'ובראן "צדק במרחב המשפט הפרטי" עיוני משפט מא 417 (2019).',
    },
  ];
  return (
    <CardShell caption="מקורות משפטיים מאומתים">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {items.map((it, i) => {
          const tick = interpolate(frame - 20 - i * 6, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "22px 24px",
                background: "#F7F9FC",
                borderRadius: 14,
                border: "1px solid #E5EAF0",
                direction: "rtl",
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  background: tick > 0.2 ? COLORS.teal : "#E5EAF0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontFamily: '"Heebo"',
                  fontWeight: 800,
                  fontSize: 22,
                  transform: `scale(${0.5 + tick * 0.5})`,
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
              <span
                style={{
                  fontFamily: '"Heebo"',
                  fontSize: 16,
                  fontWeight: 700,
                  color: it.tagColor,
                  background: it.tagBg,
                  padding: "6px 14px",
                  borderRadius: 999,
                  flexShrink: 0,
                }}
              >
                {it.tag}
              </span>
              <span
                style={{
                  flex: 1,
                  fontFamily: '"Heebo"',
                  fontSize: 21,
                  fontWeight: 500,
                  color: COLORS.cardInk,
                  lineHeight: 1.45,
                }}
              >
                {it.text}
              </span>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
};

const Footnoted: React.FC = () => {
  const frame = useCurrentFrame();
  const lines = [
    { txt: "ההלכה בעניין זה התגבשה לאורך השנים", sup: "1" },
    { txt: "בית המשפט קבע מסגרת ברורה לאיזון", sup: "2" },
    { txt: "ראו דיון נרחב בספרות האקדמית", sup: "3" },
  ];
  return (
    <CardShell caption="תשובות מבוססות מקורות">
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {lines.map((l, i) => {
          const p = 0.5 + 0.5 * Math.sin((frame - i * 12) / 4);
          return (
            <div key={i} style={{ fontFamily: '"Heebo"', fontSize: 26, color: COLORS.cardInk, lineHeight: 1.6, direction: "rtl", textAlign: "right" }}>
              {l.txt}
              <sup
                style={{
                  fontSize: 18,
                  color: COLORS.blue,
                  fontWeight: 800,
                  marginRight: 4,
                  marginLeft: 4,
                  opacity: 0.5 + p * 0.5,
                }}
              >
                {l.sup}
              </sup>
            </div>
          );
        })}
        <div style={{ height: 1, background: "#E5EAF0", margin: "12px 0" }} />
        {[1, 2, 3].map((n, i) => (
          <div
            key={n}
            style={{
              display: "flex",
              gap: 12,
              fontFamily: '"Heebo"',
              fontSize: 18,
              color: COLORS.mutedDeep,
              direction: "rtl",
              opacity: interpolate(frame - 24 - i * 6, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <span style={{ color: COLORS.blue, fontWeight: 800 }}>{n}.</span>
            <span>מקור משפטי מאומת — קישור למסמך המקור</span>
          </div>
        ))}
      </div>
    </CardShell>
  );
};

const Citation: React.FC = () => {
  const frame = useCurrentFrame();
  const text = "בג״ץ 0000/00 פלוני נ׳ אלמוני, פ״ד ע(0) 000 (0000)";
  const n = Math.floor(interpolate(frame - 14, [0, 32], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <CardShell caption="אזכור אחיד בלחיצה">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            padding: "16px 28px",
            background: GRADIENT,
            color: "white",
            borderRadius: 12,
            fontFamily: '"Heebo"',
            fontWeight: 700,
            fontSize: 22,
            boxShadow: "0 10px 24px rgba(52,152,219,0.35)",
            direction: "rtl",
          }}
        >
          הפק אזכור אחיד
        </div>
        <div
          style={{
            padding: "28px",
            background: "#F7F9FC",
            border: "1px solid #E5EAF0",
            borderRadius: 12,
            fontFamily: '"Heebo"',
            fontSize: 28,
            color: COLORS.cardInk,
            direction: "rtl",
            textAlign: "right",
            minHeight: 100,
            lineHeight: 1.5,
          }}
        >
          {text.slice(0, n)}
          <span style={{ opacity: (frame % 20) < 10 ? 1 : 0, color: COLORS.blue }}>|</span>
        </div>
        <div style={{ fontFamily: '"Heebo"', fontSize: 16, color: COLORS.mutedDeep, direction: "rtl", textAlign: "right" }}>
          בהתאם לכללי האזכור האחיד
        </div>
      </div>
    </CardShell>
  );
};

const Dashboard: React.FC = () => {
  const frame = useCurrentFrame();
  const stats = [
    { label: "שאלות", target: 142 },
    { label: "מקורות", target: 1284 },
    { label: "טיוטות", target: 36 },
  ];
  return (
    <CardShell caption="פחות חיפוש. יותר חשיבה משפטית.">
      <div style={{ display: "flex", gap: 18, direction: "rtl" }}>
        {stats.map((s, i) => {
          const t = interpolate(frame - 18 - i * 6, [0, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const v = Math.floor(s.target * t);
          return (
            <div
              key={s.label}
              style={{
                flex: 1,
                padding: 28,
                background: "#F7F9FC",
                border: "1px solid #E5EAF0",
                borderRadius: 16,
                direction: "rtl",
              }}
            >
              <div style={{ fontFamily: '"Heebo"', fontSize: 18, color: COLORS.mutedDeep, fontWeight: 600 }}>
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: '"Heebo"',
                  fontSize: 64,
                  fontWeight: 800,
                  color: COLORS.cardInk,
                  letterSpacing: "-0.02em",
                  marginTop: 8,
                  background: GRADIENT,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {v.toLocaleString("he-IL")}
              </div>
              <div
                style={{
                  height: 6,
                  background: "#E5EAF0",
                  borderRadius: 3,
                  marginTop: 12,
                  overflow: "hidden",
                }}
              >
                <div style={{ height: "100%", width: `${t * 100}%`, background: GRADIENT }} />
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
};

const DASH_EXTRA = 15; // +0.5s on "פחות חיפוש. יותר חשיבה משפטית."

export const Benefits: React.FC = () => (
  <Stage>
    <Sequence from={0} durationInFrames={BEAT}><VerifiedSources /></Sequence>
    <Sequence from={BEAT} durationInFrames={BEAT}><Footnoted /></Sequence>
    <Sequence from={BEAT * 2} durationInFrames={BEAT}><Citation /></Sequence>
    <Sequence from={BEAT * 3} durationInFrames={BEAT + DASH_EXTRA}><Dashboard /></Sequence>
  </Stage>
);

export const BENEFITS_DURATION = BEAT * 4 + DASH_EXTRA;
export { VerifiedSources, Citation };
