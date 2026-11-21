# Platform contract

Everything the canvases and plugins depend on from the GitHub Copilot app. Canvas extensions and Agent Plugins 1.0 are new and moving, so **verify before relying on any row**, and record what you checked in the Verification log at the bottom.

## 1. Canvas extension

Read from public canvas extensions (`aymenfurter/awesome-canvas`, `leestott/copilot-canvas-runtime`) in November 2026.

| Item | Expected | Status |
|---|---|---|
| Entry file | `extension.mjs`, ES module, top-level `await` | Seen in public repos |
| Import | `import { createCanvas, joinSession } from "@github/copilot-sdk/extension"`, resolved by the host, no `package.json` | Seen in public repos |
| Registration | `const session = await joinSession({ canvases: [canvas] })` | Seen in public repos |
| Canvas definition | `createCanvas({ id, displayName, description, actions, open, onClose })` | Seen in public repos |
| `open(ctx)` | Returns `{ title, status, url }`; `url` is a loopback HTTP server the extension starts itself, keyed by `ctx.instanceId` | Seen in public repos |
| `onClose(ctx)` | Close that instance's server | Seen in public repos |
| Action | `{ name, description, inputSchema, handler: async (ctx) => result }`, input on `ctx.input` | Seen in public repos |
| Session API | `session.send({ prompt })` posts a turn to the agent; `session.log(message, { level })` | Seen in public repos |
| Workspace folder | `process.cwd()` | **Unverified for plugin installs** |
| Agent tools | `open_canvas({ canvasId, instanceId })`, `invoke_canvas_action({ instanceId, actionName, input })` | **Unverified**, from one README |

Standalone install locations (useful for quick tests without a plugin):

- Project scope: `<repo>/.github/extensions/<id>/extension.mjs`
- User scope: `~/.copilot/extensions/<id>/extension.mjs`

## 2. Agent Plugins 1.0 and the marketplace

| Item | Expected | Status |
|---|---|---|
| Plugin manifest | `plugin.json` at the plugin root; `$schema` and `name` required | GitHub Docs plus guides |
| Schema URL | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | GitHub Docs |
| Skills in a plugin | `skills/<name>/SKILL.md` | GitHub Docs |
| Canvases in a plugin | `com.github.copilot/extensions/<id>/extension.mjs` | **Unverified**, awesome-copilot hub only |
| Marketplace manifest | `.github/plugin/marketplace.json` with `name`, `owner`, `plugins[]` (name, description, version, source path) | **Field names unverified** |
| Install in the app | Customize → Plugins | GitHub Docs |

## 3. Open points (Phase 0 must answer)

1. Do canvases load from `com.github.copilot/extensions/` inside an installed plugin?
2. Exact tool names and inputs the agent uses to open a canvas and invoke a canvas action.
3. Does `process.cwd()` point at the workspace for a plugin-installed canvas? If not, where does the SDK expose it?
4. Exact `marketplace.json` field names, and whether `source` is relative to the repo root.
5. Can the canvas page use `EventSource` against its own loopback server? If not, fall back to polling.

## 4. Testing without the Copilot app

Stub the SDK so modules run under plain Node: a test-only `node_modules/@github/copilot-sdk` whose `createCanvas` returns its argument and whose `joinSession` captures the canvases and returns `{ send, log }` fakes. A harness can then call `open`, fetch endpoints, invoke action handlers and screenshot the page with a headless browser. Keep the stub out of plugin folders.

## 5. Verification log

| Date | Point | Result | Source checked |
|---|---|---|---|
| | | | |
