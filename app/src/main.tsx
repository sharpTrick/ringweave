import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Self-hosted fonts (no CDN → zero external requests, honoring the privacy promise).
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";

import "./styles/app.css";
import "./styles/print.css";

// Single-view app — no router, so no basename needed. When a history router is added
// later, set its basename to import.meta.env.BASE_URL (the Vite `base`).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
