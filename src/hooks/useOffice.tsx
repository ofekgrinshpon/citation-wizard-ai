import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface OfficeContextType {
  isOfficeAddin: boolean;
  isReady: boolean;
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
    };
    onReady?: (callback: (info: OfficeReadyInfo) => void) => void;
  };
};

const OfficeContext = createContext<OfficeContextType>({
  isOfficeAddin: false,
  isReady: false,
});

function isOfficeAddinRoute() {
  try {
    return new URLSearchParams(window.location.search).get("addin") === "1";
  } catch {
    return false;
  }
}

function hasOfficeHost(win: OfficeWindow) {
  return Boolean(win.Office?.context?.host || win.Office?.context?.ui || win.Office?.onReady);
}

function detectAddin(win: OfficeWindow) {
  return isOfficeAddinRoute() || hasOfficeHost(win);
}

export function OfficeProvider({ children }: { children: ReactNode }) {
  const win = window as OfficeWindow;
  const initialIsOfficeAddin = detectAddin(win);
  const [isOfficeAddin, setIsOfficeAddin] = useState(initialIsOfficeAddin);
  const [isReady, setIsReady] = useState(!initialIsOfficeAddin);

  useEffect(() => {
    const win = window as OfficeWindow;

    // If we already know we're in an addin, set it immediately
    if (detectAddin(win)) {
      setIsOfficeAddin(true);
    }

    const handleOfficeReady = (info: OfficeReadyInfo) => {
      setIsOfficeAddin(Boolean(info?.host) || detectAddin(win));
      setIsReady(true);
    };

    // Try to call onReady if available, but do NOT return early —
    // keep the interval + timeout as fallback
    if (win.Office?.onReady) {
      win.Office.onReady(handleOfficeReady);
    }

    // Poll for Office.js appearing later
    const intervalId = window.setInterval(() => {
      if (detectAddin(win)) {
        setIsOfficeAddin(true);
      }

      if (win.Office?.onReady) {
        window.clearInterval(intervalId);
        win.Office.onReady(handleOfficeReady);
      }
    }, 100);

    // Timeout fallback — after 5s, force ready and trust whatever signals we have
    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      if (detectAddin(win)) setIsOfficeAddin(true);
      setIsReady(true);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  return <OfficeContext.Provider value={{ isOfficeAddin, isReady }}>{children}</OfficeContext.Provider>;
}

export function useOffice() {
  return useContext(OfficeContext);
}
