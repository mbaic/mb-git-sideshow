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
| Workspace folder | `session.workspacePath` (string or undefined) from `joinSession`; no cwd on `ctx`. `process.cwd()` as fallback | `workspacePath` documented in one third-party README; `process.cwd()` for plugin installs **unverified until the manual test** |
| Agent tools | `open_canvas({ canvasId, instanceId, input? })` returns `{ instanceId, url? }`; `invoke_canvas_action({ instanceId, actionName, input? })`; `list_canvas_capabilities({ canvasId })` | One third-party README (mcpservers.org create-canvas skill); **not in official docs**; confirm in manual test |
| Context shapes | `open` ctx `{ sessionId, extensionId, canvasId, instanceId, input, host }`; action ctx adds `actionName`; errors via `throw new CanvasError(code, message)`; `open` must be idempotent per `instanceId`; action names must not start with `canvas.` | Same README |
| Constraints | stdout is reserved for JSON-RPC: never `console.log`. Node 20.19+. TypeScript unsupported | Same README / gist |

Standalone install locations (useful for quick tests without a plugin):

- Project scope: `<repo>/.github/extensions/<id>/extension.mjs`
- User scope: `~/.copilot/extensions/<id>/extension.mjs`

## 2. Agent Plugins 1.0 and the marketplace

| Item | Expected | Status |
|---|---|---|
| Plugin manifest | `plugin.json` at the plugin root; `$schema` and `name` required; optional version, description, author, homepage, repository, license, keywords, `extensions`. Component path fields (`skills`, `mcpServers`) are not allowed in 1.0 format | GitHub Docs plus guides |
| Schema URL | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | GitHub Docs |
| Skills in a plugin | `skills/<name>/SKILL.md` | GitHub Docs |
| Canvases in a plugin | `com.github.copilot/extensions/<id>/extension.mjs` | **Unverified.** Official docs say a canvas can ship in a plugin but give no path. The reference page only says client-specific files live in a top-level directory named after the reverse-domain namespace. Manual test decides |
| Marketplace manifest | `.github/plugin/marketplace.json`: `name`, `owner { name, email? }`, `plugins[]`; entry requires `name`, `source`; optional `description`, `version`, others. `source` relative to repo root, leading `./` optional | Verified in docs (docs differ on whether description/version sit top-level or under `metadata`; we use per-entry) |
| Install in the app | Customize → Plugins; icon next to the marketplace dropdown adds a GitHub repo or Git URL; then Install | GitHub Docs |
| Install in CLI | `copilot plugin marketplace add OWNER/REPO`, `copilot plugin install NAME@MARKETPLACE` | GitHub Docs |

## 3. Open points (Phase 0 must answer)

1. **Open.** Do canvases load from `com.github.copilot/extensions/` inside an installed plugin?
2. **Partly answered.** Exact tool names and inputs the agent uses to open a canvas and invoke a canvas action.
3. **Open.** Does `process.cwd()` point at the workspace for a plugin-installed canvas? If not, where does the SDK expose it?
4. **Answered.** Exact `marketplace.json` field names, and whether `source` is relative to the repo root.
5. **Open.** Can the canvas page use `EventSource` against its own loopback server? If not, fall back to polling.

## 4. Testing without the Copilot app

Stub the SDK so modules run under plain Node: a test-only `node_modules/@github/copilot-sdk` whose `createCanvas` returns its argument and whose `joinSession` captures the canvases and returns `{ send, log }` fakes. A harness can then call `open`, fetch endpoints, invoke action handlers and screenshot the page with a headless browser. Keep the stub out of plugin folders.

## 5. Verification log

| Date | Point | Result | Source checked |
|---|---|---|---|
| 2026-11-21 | 1 canvas in plugin path | Docs confirm canvases can ship in plugins, give no path. Unverified | docs.github.com working-with-canvas-extensions; plugin-and-marketplace-reference |
| 2026-11-21 | 2 tool names | `open_canvas`, `invoke_canvas_action`, `list_canvas_capabilities` seen in one third-party README only. Official docs name no built-in tools | mcpservers.org agent-skills/github/create-canvas |
| 2026-11-21 | 3 workspace folder | `session.workspacePath` documented in same README; cwd unverified | same |
| 2026-11-21 | 4 marketplace.json | Field names and root-relative `source` confirmed | docs.github.com plugin-and-marketplace-reference, plugins-marketplace, cli-plugin-reference |
| 2026-11-21 | 5 EventSource | README says "Push state updates ... with Server-Sent Events (/events)", no client code. Unverified in the app; keep polling fallback | same README |
| 2026-11-21 | import / createCanvas / joinSession | Import path and shapes consistent across README, gist, and official CLI-extension tutorial | docs.github.com tutorials/create-an-extension; gist AndreaGriffiths11/b9ebe41d... |
| 2026-11-21 | Limits of this check | Docs read via fetch summaries, not raw pages. github/awesome-canvas repos not readable from the build session (repo scope). Official page has no API detail | |
| 2026-11-26 | 3 workspace folder | The SDK docs call `workspacePath` the "session workspace" (artifacts, cleaned up with the session), not the repo; docs say nothing about the extension process cwd. A real run showed Commit Constellations finding no repo when it used workspacePath alone. Commit Constellations, Build Horoscope and Standup Seance now probe `workspacePath`, `process.cwd()`, `INIT_CWD`, `PWD` with `git rev-parse --show-toplevel` and the empty state lists each folder with git's stderr. Which one works in the app is still to be read off that message | mcpservers.org create-canvas skill; awesome-copilot working-with-canvas-extensions |
