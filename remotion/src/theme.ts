import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "700", "800"],
  subsets: ["hebrew", "latin"],
});

export const HEBREW_FONT = fontFamily;

export const COLORS = {
  ink: "#0B1220",
  inkDeep: "#070C16",
  inkLine: "#1E2A3D",
  blue: "#3498DB",
  blueDeep: "#1E6FA8",
  teal: "#30A98C",
  light: "#F1F4F7",
  card: "#FFFFFF",
  cardInk: "#1F2A3A",
  muted: "#94A3B8",
  mutedDeep: "#5A6B82",
  hairline: "rgba(241,244,247,0.08)",
  ok: "#30A98C",
  warn: "#E0A23C",
};

export const GRADIENT = `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.teal})`;
