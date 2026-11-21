// Test-only stand-in for @github/copilot-sdk/extension.
export const captured = { canvases: [], session: null };
export class CanvasError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function createCanvas(def) { return def; }
export async function joinSession(opts = {}) {
  captured.canvases = opts.canvases ?? [];
  captured.session = {
    sessionId: "stub-session",
    workspacePath: process.env.STUB_WORKSPACE ?? undefined,
    sent: [], logs: [],
    send: async (m) => { captured.session.sent.push(m); },
    log: async (m, o) => { captured.session.logs.push({ m, o }); },
    on() {},
  };
  return captured.session;
}
