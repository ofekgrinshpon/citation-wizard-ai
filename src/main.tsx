// Shim localStorage BEFORE any other imports (Supabase reads it immediately)
import { shimLocalStorageIfNeeded } from "./lib/safeStorage";
shimLocalStorageIfNeeded();

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

function renderApp() {
  createRoot(document.getElementById("root")!).render(<App />);
}

async function bootstrap() {
  const win = window as Window & { Office?: { onReady?: (callback: (info: { host?: string }) => void) => void } };
  const isAddinRoute = new URLSearchParams(window.location.search).get("addin") === "1";

  console.log("[ReLex] bootstrap start, addin param:", isAddinRoute);

  // Only wait for Office.onReady when explicitly in add-in mode (?addin=1).
  // The office.js script is loaded for all visitors but we should NOT
  // delay rendering for regular browser users just because Office.onReady exists.
  if (isAddinRoute && win.Office?.onReady) {
    let rendered = false;
    const render = () => {
      if (!rendered) {
        rendered = true;
        console.log("[ReLex] rendering app");
        renderApp();
      }
    };
    win.Office.onReady((info) => {
      console.log("[ReLex] Office.onReady fired, host:", info?.host);
      render();
    });
    setTimeout(() => {
      console.log("[ReLex] timeout fallback");
      render();
    }, 5000);
    return;
  }

  // No add-in mode — render immediately
  console.log("[ReLex] standalone mode, rendering immediately");
  renderApp();
}

void bootstrap();
