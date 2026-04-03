import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

function renderApp() {
  createRoot(document.getElementById("root")!).render(<App />);
}

// If Office.js is present and we're inside an Office host, wait for it.
// Otherwise render immediately (standalone web mode).
const win = window as any;
if (typeof win.Office !== "undefined" && win.Office.onReady) {
  win.Office.onReady(() => renderApp());
} else {
  renderApp();
}
