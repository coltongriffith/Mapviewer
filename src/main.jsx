import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App";
import "./styles.css";

if (typeof window.global === "undefined") {
  window.global = window;
}

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
