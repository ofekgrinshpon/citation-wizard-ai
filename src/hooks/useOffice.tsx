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
  return new URLSearchParams(window.location.search).get("addin") === "1";
}

function hasOfficeHost(win: OfficeWindow) {
  return Boolean(win.Office?.context?.host || win.Office?.context?.ui || win.Office?.onReady);
}

export function OfficeProvider({ children }: { children: ReactNode }) {
  const initialIsOfficeAddin = isOfficeAddinRoute() || hasOfficeHost(window as OfficeWindow);
  const [isOfficeAddin, setIsOfficeAddin] = useState(initialIsOfficeAddin);
  const [isReady, setIsReady] = useState(!initialIsOfficeAddin);

  useEffect(() => {
    const win = window as OfficeWindow;

    const addinRoute = isOfficeAddinRoute();
    const activateAddinMode = () => {
      setIsOfficeAddin(true);
      setIsReady(true);
    };

    const handleOfficeReady = (info: OfficeReadyInfo) => {
      setIsOfficeAddin(Boolean(info?.host) || hasOfficeHost(win) || addinRoute);
      setIsReady(true);
    };

    if (hasOfficeHost(win)) {
      setIsOfficeAddin(true);
    }

    if (!addinRoute && !hasOfficeHost(win)) {
      setIsReady(true);
    }

    if (win.Office?.onReady) {
      win.Office.onReady(handleOfficeReady);
      return;
    }

    const intervalId = window.setInterval(() => {
      if (hasOfficeHost(win) && !win.Office?.onReady) {
        activateAddinMode();
      }

      if (win.Office?.onReady) {
        window.clearInterval(intervalId);
        win.Office.onReady(handleOfficeReady);
      }
    }, 100);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      if (addinRoute || hasOfficeHost(win)) setIsOfficeAddin(true);
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
