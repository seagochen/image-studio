import React from "react";
import ReactDOM from "react-dom/client";
import { requireUser } from "./shared/auth";
import { Studio } from "./studio/Studio";
import { APP_BASE_PATH, loadRuntimeConfig } from "./runtime/runtimeConfig";
import { startImageStudio } from "./runtime/bootstrap";
import "./styles.css";
import "./shared/icons.css";

const root = document.getElementById("root");
if (!root) throw new Error("Image Studio root element is missing");

void startImageStudio({
  loadConfig: () => loadRuntimeConfig(),
  // Platform mode reuses the skillsmaster session; standalone mode has no skillsmaster login.
  requireUser: () => requireUser(APP_BASE_PATH.replace(/\/$/, ""), "image-studio"),
  render: () => ReactDOM.createRoot(root).render(<React.StrictMode><Studio /></React.StrictMode>),
  // Never guess a mode: a platform mount whose config is unreachable must not become a local single-user editor.
  showError: (message) => { root.textContent = message; },
});
