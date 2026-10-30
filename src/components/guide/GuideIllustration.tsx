import { useState } from "react";
import { FileText, Maximize2 } from "lucide-react";

/** Hosted guide assets are not included in every checkout; keep instructions usable without them. */
export function GuideIllustration({ src, alt, label, onZoom }: { src: string; alt: string; label: string; onZoom?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) return <div className="rounded-xl border border-border bg-accent/40 p-6 flex flex-col items-center gap-2 text-primary" aria-hidden="true"><FileText className="h-10 w-10" /><span className="text-sm font-medium">{label}</span></div>;
  const illustration = <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className="block w-full h-auto max-h-64 object-cover object-top" />;
  if (!onZoom) return <div className="overflow-hidden rounded-xl border border-border bg-muted/40">{illustration}</div>;
  return <button type="button" onClick={onZoom} disabled={!loaded} aria-label={`להגדלת צילום המסך: ${label}`} className="group relative block w-full overflow-hidden rounded-xl border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {illustration}
    {loaded && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm border border-border"><Maximize2 className="h-3 w-3" aria-hidden="true" />הגדלה</span>}
  </button>;
}
