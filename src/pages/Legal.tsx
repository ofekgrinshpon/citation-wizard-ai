import { useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ReLexLogo } from "@/components/ReLexLogo";
import { TERMS_MARKDOWN } from "@/content/legal/terms";
import { PRIVACY_MARKDOWN } from "@/content/legal/privacy";

type LegalDoc = "terms" | "privacy";

const DOCS: Record<LegalDoc, { markdown: string; title: string; description: string }> = {
  terms: {
    markdown: TERMS_MARKDOWN,
    title: "תנאי שימוש | ReLex",
    description:
      "תנאי השימוש של ReLex — כלי עזר למחקר משפטי, אזכור אחיד, הערות שוליים וביבליוגרפיה. השירות אינו ייעוץ משפטי.",
  },
  privacy: {
    markdown: PRIVACY_MARKDOWN,
    title: "מדיניות פרטיות | ReLex",
    description:
      "מדיניות הפרטיות של ReLex — איזה מידע נאסף, כיצד הוא מעובד, אילו ספקים חיצוניים מעורבים וכיצד לממש זכויות פרטיות.",
  },
};

/** Inline markdown: **bold**, `code`, and [text](url) links (incl. mailto:). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-i${i++}`;
    if (match[1] !== undefined) {
      const href = match[2];
      const external = !href.startsWith("mailto:");
      nodes.push(
        <a
          key={key}
          href={href}
          className="text-primary underline underline-offset-2 hover:opacity-80"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          dir={href.startsWith("mailto:") ? "ltr" : undefined}
        >
          {match[1]}
        </a>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {match[3]}
        </strong>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {match[4]}
        </code>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Minimal RTL-aware markdown renderer for the legal documents (headings, lists, paragraphs). */
function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    listBuffer = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-1.5 pr-6 text-sm leading-7 text-muted-foreground">
        {items.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${key}-${idx}`)}</li>
        ))}
      </ul>,
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*[*-]\s+/.test(line)) {
      listBuffer.push(line.replace(/^\s*[*-]\s+/, ""));
      continue;
    }
    flushList();

    if (line.trim() === "") continue;

    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${key++}`} className="mt-6 text-base font-semibold text-foreground">
          {renderInline(line.slice(4), `h3-${key}`)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={`h2-${key++}`} className="mt-8 border-b border-border pb-1.5 text-lg font-bold text-foreground">
          {renderInline(line.slice(3), `h2-${key}`)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={`h1-${key++}`} className="text-2xl font-bold text-foreground">
          {renderInline(line.slice(2), `h1-${key}`)}
        </h1>,
      );
    } else {
      blocks.push(
        <p key={`p-${key++}`} className="text-sm leading-7 text-muted-foreground">
          {renderInline(line, `p-${key}`)}
        </p>,
      );
    }
  }
  flushList();
  return blocks;
}

const Legal = ({ doc }: { doc: LegalDoc }) => {
  const navigate = useNavigate();
  const { markdown, title, description } = DOCS[doc];

  useEffect(() => {
    document.title = title;

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("description", description);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}/${doc}`;
  }, [doc, title, description]);

  const content = useMemo(() => renderMarkdown(markdown), [markdown]);

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" aria-label="חזרה לעמוד הראשי">
            <ReLexLogo size={28} />
          </button>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← חזרה
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="space-y-3">{content}</article>

        <nav className="mt-12 flex items-center justify-center gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
          <a href="/terms" className="hover:text-foreground">תנאי שימוש</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-foreground">מדיניות פרטיות</a>
          <span>·</span>
          <a href="mailto:support@relexlm.com" className="hover:text-foreground" dir="ltr">support@relexlm.com</a>
        </nav>
      </main>
    </div>
  );
};

export default Legal;
