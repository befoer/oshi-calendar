import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
import "./cache-cleanup";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
