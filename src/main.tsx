import React from "react";
import ReactDOM from "react-dom/client";
import { requireUser } from "../../shared/auth";
import { Studio } from "./studio/Studio";
import "./styles.css";
import "../../../frontend/src/public/styles/icons.css";

async function start(): Promise<void> {
  if (!(await requireUser("/apps/image-studio", "image-studio"))) return;
  const root = document.getElementById("root");
  if (!root) throw new Error("Image Studio root element is missing");
  ReactDOM.createRoot(root).render(<React.StrictMode><Studio /></React.StrictMode>);
}

void start();
