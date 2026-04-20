// Shared brand tokens for all ReLex auth email templates.
// Email clients have weak CSS support — keep colors solid (no gradients in
// buttons/backgrounds), use web-safe fonts, and inline every style.

export const BRAND = {
  name: "ReLex",
  tagline: "מערכת אזכור משפטי",
  url: "https://relexlm.com",
  logoUrl:
    "https://ioktiqcffungtlsmlkcv.supabase.co/storage/v1/object/public/email-assets/relex-logo.png",
  // Pulled from src/index.css --primary (204 70% 53%) flattened to hex
  primary: "#3ea3d3",
  primaryFg: "#ffffff",
  // Foreground / text
  fg: "#2a3441", // ~ --foreground
  muted: "#6b7785", // ~ --muted-foreground
  border: "#e5e9ef",
  bg: "#ffffff",
  // 0.75rem
  radius: "12px",
} as const;

export const styles = {
  main: {
    backgroundColor: BRAND.bg,
    fontFamily:
      '"Segoe UI", Arial, "Helvetica Neue", Helvetica, sans-serif',
    margin: 0,
    padding: 0,
  },
  container: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "32px 28px",
    direction: "rtl" as const,
    textAlign: "right" as const,
  },
  logoWrap: {
    textAlign: "center" as const,
    margin: "0 0 24px",
  },
  logo: {
    height: "44px",
    width: "auto",
  },
  card: {
    border: `1px solid ${BRAND.border}`,
    borderRadius: BRAND.radius,
    padding: "28px 24px",
    backgroundColor: BRAND.bg,
  },
  h1: {
    fontSize: "22px",
    fontWeight: 700 as const,
    color: BRAND.fg,
    margin: "0 0 16px",
    textAlign: "right" as const,
    direction: "rtl" as const,
  },
  text: {
    fontSize: "15px",
    color: BRAND.fg,
    lineHeight: "1.6",
    margin: "0 0 18px",
    textAlign: "right" as const,
    direction: "rtl" as const,
  },
  textMuted: {
    fontSize: "13px",
    color: BRAND.muted,
    lineHeight: "1.6",
    margin: "20px 0 0",
    textAlign: "right" as const,
    direction: "rtl" as const,
  },
  buttonWrap: {
    textAlign: "center" as const,
    margin: "26px 0 8px",
  },
  button: {
    backgroundColor: BRAND.primary,
    color: BRAND.primaryFg,
    fontSize: "15px",
    fontWeight: 600 as const,
    borderRadius: BRAND.radius,
    padding: "13px 28px",
    textDecoration: "none",
    display: "inline-block",
  },
  link: { color: BRAND.primary, textDecoration: "underline" },
  code: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: "26px",
    fontWeight: 700 as const,
    color: BRAND.fg,
    letterSpacing: "6px",
    backgroundColor: "#f4f6f9",
    border: `1px solid ${BRAND.border}`,
    borderRadius: "8px",
    padding: "14px 18px",
    margin: "8px 0 22px",
    textAlign: "center" as const,
    direction: "ltr" as const,
  },
  footer: {
    fontSize: "12px",
    color: BRAND.muted,
    textAlign: "center" as const,
    margin: "26px 0 0",
    lineHeight: "1.6",
    direction: "rtl" as const,
  },
  footerLink: {
    color: BRAND.muted,
    textDecoration: "underline",
  },
};
