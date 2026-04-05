import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface OfficeContextType {
  isOfficeAddin: boolean;
  isReady: boolean;
  hasDocumentAccess: boolean;
}

type OfficeReadyInfo = {
  host?: string;
  platform?: string;
};

type OfficeWindow = Window & {
  Office?: {
    context?: {
      host?: string;
      ui?: unknown;
      document?: unknown;
    };
    onReady?: (callback: (info: OfficeReadyInfo) => void) => void;
  };
  Word?: {
    run?: Function;
  };
};

const OfficeContext = createContext<OfficeContextType>({
  isOfficeAddin: false,
  isReady: false,
  hasDocumentAccess: false,
});

function isOfficeAddinRoute() {
  try {
    return new URLSearchParams(window.location.search).get("addin") === "1";
  } catch {
    return false;
  }
}

function hasOfficeHost(win: OfficeWindow) {
  return Boolean(win.Office?.context?.host || win.Office?.context?.ui);
}

function detectAddin(win: OfficeWindow) {
  return isOfficeAddinRoute() || hasOfficeHost(win);
}

/** Check if Word document APIs are actually available for insertion (passive check) */
function checkDocumentAccess(win: OfficeWindow): boolean {
  // Don't trust Word.run alone — it exists as a stub before the bridge is ready
  return Boolean(win.Office?.context?.document);
}

/** Active probe: actually call Word.run to verify the Rich API bridge works */
async function probeWordRun(win: OfficeWindow): Promise<boolean> {
  if (!win.Word?.run) return false;
  try {
    await (win.Word.run as any)(async (ctx: any) => { await ctx.sync(); });
    return true;
  } catch {
    return false;
  }
}

export function OfficeProvider({ children }: { children: ReactNode }) {
  const win = window as OfficeWindow;
  const initialIsOfficeAddin = detectAddin(win);
  const [isOfficeAddin, setIsOfficeAddin] = useState(initialIsOfficeAddin);
  const [isReady, setIsReady] = useState(!initialIsOfficeAddin);
  const [hasDocumentAccess, setHasDocumentAccess] = useState(checkDocumentAccess(win));

  useEffect(() => {
    const win = window as OfficeWindow;

    if (detectAddin(win)) {
      setIsOfficeAddin(true);
    }

    const updateDocAccess = () => {
      if (checkDocumentAccess(win)) {
        setHasDocumentAccess(true);
      }
    };

    const handleOfficeReady = (info: OfficeReadyInfo) => {
      if (info?.host) setIsOfficeAddin(true);
      else if (detectAddin(win)) setIsOfficeAddin(true);
      setIsReady(true);
      updateDocAccess();
    };

    if (win.Office?.onReady) {
      win.Office.onReady(handleOfficeReady);
    }

    // Poll for Office.js appearing later AND for document access
    const intervalId = window.setInterval(() => {
      if (detectAddin(win)) {
        setIsOfficeAddin(true);
      }

      updateDocAccess();

      if (win.Office?.onReady) {
        window.clearInterval(intervalId);
        win.Office.onReady(handleOfficeReady);
      }
    }, 100);

    // Extended polling for document access — use active probe for Word.run
    let docPollStopped = false;
    const docPollId = window.setInterval(async () => {
      if (docPollStopped) return;
      // Passive check first (fast)
      if (checkDocumentAccess(win)) {
        setHasDocumentAccess(true);
        docPollStopped = true;
        window.clearInterval(docPollId);
        return;
      }
      // Active probe (slower but definitive)
      const probeOk = await probeWordRun(win);
      if (probeOk) {
        setHasDocumentAccess(true);
        docPollStopped = true;
        window.clearInterval(docPollId);
      }
    }, 1000);

    // Timeout fallback — extended to 15s for Word Online
    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      docPollStopped = true;
      window.clearInterval(docPollId);
      if (detectAddin(win)) setIsOfficeAddin(true);
      updateDocAccess();
      setIsReady(true);
      // Force-unblock UI in add-in mode so insertion function's own error handling takes over
      if (detectAddin(win)) {
        console.log("[Office] Timeout reached in addin mode — force-enabling hasDocumentAccess");
        setHasDocumentAccess(true);
      }
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(docPollId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <OfficeContext.Provider value={{ isOfficeAddin, isReady, hasDocumentAccess }}>
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
