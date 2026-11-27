import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub/hooks.mjs", import.meta.url);

const stub = await import("./stub/sdk-extension.mjs");
await import("../plugins/mb-hello-canvas/com.github.copilot/extensions/mb-hello-canvas/extension.mjs");

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
  const pj = JSON.parse(await readFile(new URL("../plugins/mb-hello-canvas/plugin.json", import.meta.url)));
  const entry = mk.plugins.find((p) => p.name === "mb-hello-canvas");
  assert.equal(entry.version, pj.version);
  assert.equal(entry.source, "./plugins/mb-hello-canvas");
  assert.equal(pj.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
});

test("every marketplace entry points at a plugin whose manifest matches", async () => {
  const { readFile } = await import("node:fs/promises");
  const mk = JSON.parse(await readFile(new URL("../.github/plugin/marketplace.json", import.meta.url)));
  for (const e of mk.plugins) {
    const pj = JSON.parse(await readFile(new URL(`../${e.source}/plugin.json`, import.meta.url)));
    assert.equal(pj.name, e.name);
    assert.match(e.name, /^mb-/);
    assert.equal(pj.version, e.version, `${e.name}: version mismatch`);
    const ext = new URL(`../${e.source}/com.github.copilot/extensions/${e.name}/extension.mjs`, import.meta.url);
    await readFile(ext);
  }
});

test("every skill name starts with mb- and matches its folder", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const root = new URL("../plugins/", import.meta.url);
  for (const plugin of (await readdir(root)).filter((n) => n.startsWith("mb-"))) {
    for (const dir of await readdir(new URL(`${plugin}/skills/`, root))) {
      const text = await readFile(new URL(`${plugin}/skills/${dir}/SKILL.md`, root), "utf8");
      assert.equal(text.match(/^name: (.+)$/m)[1].trim(), dir);
      assert.match(dir, /^mb-/);
    }
  }
});
