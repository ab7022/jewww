// Fixture apps report what actually happened to the harness, which grades on it.
window.__log = (type, data = {}) =>
  fetch("/__event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...data }) });
