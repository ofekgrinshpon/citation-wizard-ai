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

/** Check if Word document APIs are actually available for insertion */
function checkDocumentAccess(win: OfficeWindow): boolean {
  return Boolean(win.Office?.context?.document || win.Word?.run);
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

    // Extended polling for document access (Word Online can be slow)
    const docPollId = window.setInterval(() => {
      if (checkDocumentAccess(win)) {
        setHasDocumentAccess(true);
        window.clearInterval(docPollId);
      }
    }, 500);

    // Timeout fallback
    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      window.clearInterval(docPollId);
      if (detectAddin(win)) setIsOfficeAddin(true);
      updateDocAccess();
      setIsReady(true);
    }, 5000);

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
