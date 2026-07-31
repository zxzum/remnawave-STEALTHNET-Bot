import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/init";
import App from "./App";
import "./index.css";
import "./cabinet.css";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
