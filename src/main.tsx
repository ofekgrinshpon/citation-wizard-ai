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
  const win = window as Window & { Office?: { onReady?: (callback: () => void) => void } };

  console.log("[ReLex] bootstrap start");

  // Office.js is loaded statically in index.html.
  // If Office.onReady is available, wait for it (with timeout fallback).
  if (win.Office?.onReady) {
    let rendered = false;
    const render = () => {
      if (!rendered) {
        rendered = true;
        console.log("[ReLex] rendering app");
        renderApp();
      }
    };
    win.Office.onReady(() => {
      console.log("[ReLex] Office.onReady fired");
      render();
    });
    setTimeout(() => {
      console.log("[ReLex] timeout fallback");
      render();
    }, 5000);
    return;
  }

  // No Office environment — render immediately
  console.log("[ReLex] standalone mode, rendering immediately");
  renderApp();
}

void bootstrap();
