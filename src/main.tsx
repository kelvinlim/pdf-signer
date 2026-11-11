import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";
import "./App.css";

const rootEl = document.getElementById("root") as HTMLElement;

function showBootError(reason: unknown) {
  if (rootEl.dataset.ready) return;
  rootEl.dataset.ready = "error";
  const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = msg;
  const p = document.createElement("p");
  p.style.color = "#b00020";
  p.textContent = "PDF Signer failed to start.";
  const main = document.createElement("main");
  main.style.fontFamily = "system-ui, sans-serif";
  main.style.padding = "16px";
  main.append(p, pre);
  rootEl.replaceChildren(main);
}

window.addEventListener("error", (ev) => {
  showBootError(ev.error ?? ev.message);
});
window.addEventListener("unhandledrejection", (ev) => {
  showBootError(ev.reason);
});

void import("./App")
  .then(({ default: App }) => {
    rootEl.dataset.ready = "1";
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch(showBootError);
