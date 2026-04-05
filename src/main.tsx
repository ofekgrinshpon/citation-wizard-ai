import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const OFFICE_JS_URL = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

function renderApp() {
  createRoot(document.getElementById("root")!).render(<App />);
}

function isOfficeAddinRoute() {
  return new URLSearchParams(window.location.search).get("addin") === "1";
}

function loadOfficeJs() {
  return new Promise<void>((resolve, reject) => {
    const win = window as Window & { Office?: { onReady?: (callback: () => void) => void } };

    if (win.Office?.onReady) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-office-js="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Office.js")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = OFFICE_JS_URL;
    script.async = true;
    script.dataset.officeJs = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Office.js"));
    document.head.appendChild(script);
  });
}

async function bootstrap() {
  const win = window as Window & { Office?: { onReady?: (callback: () => void) => void } };

  console.log("[ReLex] bootstrap start, addin=", isOfficeAddinRoute());

  if (!isOfficeAddinRoute()) {
    console.log("[ReLex] standalone mode, rendering immediately");
    renderApp();
    return;
  }

  try {
    console.log("[ReLex] loading Office.js...");
    await loadOfficeJs();
    console.log("[ReLex] Office.js loaded, onReady=", !!win.Office?.onReady);

    if (win.Office?.onReady) {
      let rendered = false;
      const render = () => { if (!rendered) { rendered = true; console.log("[ReLex] rendering app"); renderApp(); } };
      win.Office.onReady(() => { console.log("[ReLex] Office.onReady fired"); render(); });
      setTimeout(() => { console.log("[ReLex] timeout fallback"); render(); }, 5000);
      return;
    }
  } catch (error) {
    console.warn("[ReLex] Office.js failed, falling back to standalone mode.", error);
  }

  renderApp();
}

void bootstrap();
