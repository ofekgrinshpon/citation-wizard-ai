import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface OfficeContextType {
  isOfficeAddin: boolean;
  isReady: boolean;
}

const OfficeContext = createContext<OfficeContextType>({
  isOfficeAddin: false,
  isReady: false,
});

function isOfficeAddinRoute() {
  return new URLSearchParams(window.location.search).get("addin") === "1";
}

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [isOfficeAddin, setIsOfficeAddin] = useState(isOfficeAddinRoute());
  const [isReady, setIsReady] = useState(!isOfficeAddinRoute());

  useEffect(() => {
    const win = window as Window & {
      Office?: {
        onReady?: (callback: (info: { host?: string; platform?: string }) => void) => void;
      };
    };

    const addinRoute = isOfficeAddinRoute();

    if (!addinRoute) {
      setIsReady(true);
      return;
    }

    if (win.Office?.onReady) {
      win.Office.onReady((info) => {
        setIsOfficeAddin(Boolean(info?.host) || addinRoute);
        setIsReady(true);
      });
      return;
    }

    const intervalId = window.setInterval(() => {
      if (win.Office?.onReady) {
        window.clearInterval(intervalId);
        win.Office.onReady((info) => {
          setIsOfficeAddin(Boolean(info?.host) || addinRoute);
          setIsReady(true);
        });
      }
    }, 100);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      if (addinRoute) setIsOfficeAddin(true);
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
