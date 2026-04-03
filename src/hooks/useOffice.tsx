import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface OfficeContextType {
  isOfficeAddin: boolean;
  isReady: boolean;
}

const OfficeContext = createContext<OfficeContextType>({
  isOfficeAddin: false,
  isReady: false,
});

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [isOfficeAddin, setIsOfficeAddin] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check if Office.js is available (loaded from CDN in index.html)
    const win = window as any;
    if (typeof win.Office !== "undefined" && win.Office.onReady) {
      win.Office.onReady((info: { host: string; platform: string }) => {
        // host will be "Word", "Excel", etc. when running inside Office
        if (info.host) {
          setIsOfficeAddin(true);
        }
        setIsReady(true);
      });
    } else {
      // Not inside Office — standalone web mode
      setIsReady(true);
    }
  }, []);

  return (
    <OfficeContext.Provider value={{ isOfficeAddin, isReady }}>
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
