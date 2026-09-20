import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./style.css";

/**
 * Anything thrown while rendering leaves the side panel completely blank, which is
 * the least debuggable failure this UI has — it happened for real when a persisted
 * state from an older build arrived without the field the new panel expected.
 */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app">
        <div className="signin">
          <h1>Something broke in the panel</h1>
          <div className="banner bad">{error.message}</div>
          <button
            className="ghost block"
            onClick={() => {
              void chrome.storage.local.remove("panelState").then(() => location.reload());
            }}
          >
            Reset and reload
          </button>
        </div>
      </div>
    );
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <Boundary>
      <App />
    </Boundary>,
  );
}
