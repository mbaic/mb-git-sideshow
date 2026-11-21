import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub/hooks.mjs", import.meta.url);

const stub = await import("./stub/sdk-extension.mjs");
await import("../plugins/hello-canvas/com.github.copilot/extensions/hello-canvas/extension.mjs");

const canvas = stub.captured.canvases.find((c) => c.id === "hello-canvas");

test("registers hello-canvas with a ping action", () => {
  assert.ok(canvas);
  assert.deepEqual(canvas.actions.map((a) => a.name), ["ping"]);
});

test("ping returns pong and cwd", async () => {
  const r = await canvas.actions[0].handler({ input: {}, instanceId: "i1" });
  assert.equal(r.pong, true);
  assert.equal(r.cwd, process.cwd());
});

test("open serves the page on loopback only with the token; onClose stops it", async () => {
  const { url, title } = await canvas.open({ instanceId: "i1", input: {} });
  assert.equal(title, "Hello Canvas");
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
  const bare = await fetch(url.split("?")[0]);
  assert.equal(bare.status, 403);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const info = await (await fetch(url.replace("/?", "/info?"))).json();
  assert.equal(info.cwd, process.cwd());
  assert.equal(info.hello, "Hello from hello-canvas");
  await canvas.onClose({ instanceId: "i1" });
  await assert.rejects(fetch(url));
});

test("open is idempotent per instanceId", async () => {
  const a = await canvas.open({ instanceId: "i2" });
  const b = await canvas.open({ instanceId: "i2" });
  assert.equal(a.url, b.url);
  await canvas.onClose({ instanceId: "i2" });
});

test("manifests are consistent", async () => {
  const { readFile } = await import("node:fs/promises");
  const mk = JSON.parse(await readFile(new URL("../.github/plugin/marketplace.json", import.meta.url)));
  const pj = JSON.parse(await readFile(new URL("../plugins/hello-canvas/plugin.json", import.meta.url)));
  const entry = mk.plugins.find((p) => p.name === "hello-canvas");
  assert.equal(entry.version, pj.version);
  assert.equal(entry.source, "./plugins/hello-canvas");
  assert.equal(pj.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
});
