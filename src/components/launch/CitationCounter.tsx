import { useEffect, useRef, useState } from "react";

const TARGET = 950;
const DURATION_MS = 1800;

export function CitationCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(TARGET); return; }
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / DURATION_MS);
        setValue(Math.round(TARGET * (1 - Math.pow(1 - p, 3))));
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => { obs.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return (
    <div ref={ref} dir="rtl" className="rounded-2xl border border-border bg-card/70 backdrop-blur px-6 py-10 text-center shadow-sm">
      <div className="text-5xl md:text-6xl font-extrabold tabular-nums bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>
        <span dir="ltr">{value.toLocaleString("he-IL")}+</span>
      </div>
      <p className="mt-3 text-lg md:text-xl font-semibold text-foreground">אזכורים כבר נוצרו עם ReLex</p>
    </div>
  );
}
