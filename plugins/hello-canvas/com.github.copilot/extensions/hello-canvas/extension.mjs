// hello-canvas: throwaway Phase 0 canvas. Shows one line and the process cwd;
// one action, ping, returns { pong, cwd, workspacePath }.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const servers = new Map(); // instanceId -> { server }

function startServer() {
  const token = randomUUID();
  const page = `<!doctype html><meta charset="utf-8"><title>hello-canvas</title>
<body style="font-family:sans-serif;padding:1em"><p id="hello"></p><p>cwd: <code id="cwd"></code></p>
<p>workspacePath: <code id="ws"></code></p>
<script>
fetch("info?token=${token}").then(r=>r.json()).then(i=>{
  document.getElementById("hello").textContent=i.hello;
  document.getElementById("cwd").textContent=i.cwd;
  document.getElementById("ws").textContent=String(i.workspacePath);
});
</script></body>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.searchParams.get("token") !== token) { res.writeHead(403).end("forbidden"); return; }
    if (u.pathname === "/info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hello: "Hello from hello-canvas", cwd: process.cwd(), workspacePath: session?.workspacePath ?? null }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/?token=${token}` }));
  });
}

const canvas = createCanvas({
  id: "hello-canvas",
  displayName: "Hello Canvas",
  description: "Throwaway Phase 0 canvas: shows a line of text and the process working directory.",
  actions: [
    {
      name: "ping",
      description: "Returns { pong: true, cwd, workspacePath } so the host environment can be inspected.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ pong: true, cwd: process.cwd(), workspacePath: session?.workspacePath ?? null }),
    },
  ],
  open: async (ctx) => {
    if (!servers.has(ctx.instanceId)) {
      const { server, url } = await startServer();
      servers.set(ctx.instanceId, { server, url });
    }
    return { title: "Hello Canvas", status: "ready", url: servers.get(ctx.instanceId).url };
  },
  onClose: async (ctx) => {
    servers.get(ctx.instanceId)?.server.close();
    servers.delete(ctx.instanceId);
  },
});

const session = await joinSession({ canvases: [canvas] });
