import React from "react";
import ReactDOM from "react-dom/client";
import { requireUser } from "../../shared/auth";
import { Studio } from "./studio/Studio";
import { APP_BASE_PATH, loadRuntimeConfig } from "./runtime/runtimeConfig";
import "./styles.css";
import "../../../frontend/src/public/styles/icons.css";

async function start(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Image Studio root element is missing");
  let config;
  try {
    config = await loadRuntimeConfig();
  } catch (error) {
    // Never guess a mode: a platform mount whose config is unreachable must not become a local single-user editor.
    root.textContent = `Image Studio could not start: ${(error as Error).message}`;
    return;
  }
  // Platform mode reuses the skillsmaster session; standalone mode has no skillsmaster login.
  if (config.mode === "platform" && !(await requireUser(APP_BASE_PATH.replace(/\/$/, ""), "image-studio"))) return;
  ReactDOM.createRoot(root).render(<React.StrictMode><Studio /></React.StrictMode>);
}

void start();
