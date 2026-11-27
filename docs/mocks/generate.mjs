// Regenerates the PNG mockups in docs/mocks/ from fixture repos, using the SDK stub and headless Chromium.
// Usage: node docs/mocks/generate.mjs   (needs the `playwright` package resolvable; not run by CI)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { makeRepo, commit, git, loadExtension } from "../../test/lib/fixture.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = createRequire(`${process.env.NODE_TOOLS ?? "/opt/node-tools"}/`)("playwright"); }
const { chromium } = playwright;
const out = (name) => fileURLToPath(new URL(`./${name}.png`, import.meta.url));
const ext = (plugin) => `plugins/${plugin}/com.github.copilot/extensions/${plugin}/extension.mjs`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(plugin, repo, { viewport, name, before }) {
  process.env.STUB_WORKSPACE = repo;
  const loaded = await loadExtension(ext(plugin));
  loaded.session.workspacePath = repo;
  const canvas = loaded.canvases[0];
  const { url } = await canvas.open({ instanceId: name });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(url);
  await before?.({ page, canvas });
  await page.screenshot({ path: out(name) });
  await browser.close();
  await canvas.onClose({ instanceId: name });
}

// 1. Commit Constellations: 1500 commits, five authors, a few reverts.
{
  const repo = makeRepo({ name: "acme-api" });
  const people = ["Ada Lovelace", "Grace Hopper", "Linus Torvalds", "Margaret Hamilton", "Dennis Ritchie"];
  let stream = "";
  for (let i = 0; i < 1500; i++) {
    const who = people[(i * 7 + (i % 3)) % (i % 11 === 0 ? 2 : 5)];
    const t = Math.floor(Date.UTC(2025, 0, 6) / 1000) + i * 5400;
    const subject = i % 61 === 0 ? `Revert "change ${i}"` : `change ${i}`;
    stream += `commit refs/heads/main\nauthor ${who} <p@x.io> ${t} +0000\ncommitter ${who} <p@x.io> ${t} +0000\ndata ${subject.length}\n${subject}\nM 644 inline f${i % 25}.txt\ndata ${(i % 9) * 20 + 1}\n${"x".repeat((i % 9) * 20 + 1)}\n`;
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream });
  git(repo, ["reset", "-q", "--hard"]);
  await shot("commit-constellations", repo, { viewport: { width: 1200, height: 760 }, name: "commit-constellations", before: async ({ page }) => { await pause(1500); } });
}

// 2. Build Horoscope: a feature branch that is behind, with a stash and a lazy commit, and an agent reading.
{
  const repo = makeRepo({ name: "acme-api" });
  const d = (m, day) => new Date(Date.UTC(2026, m, day, 12)).toISOString();
  for (let i = 1; i <= 3; i++) commit(repo, { message: `base ${i}`, date: d(0, i), files: { [`base${i}.txt`]: "TODO\n" } });
  git(repo, ["checkout", "-q", "-b", "feature/login"]);
  commit(repo, { message: "wip", date: d(1, 2), files: { "login.js": "1\n" } });
  commit(repo, { message: "login form", date: d(1, 3), files: { "login.js": "2\n" } });
  git(repo, ["checkout", "-q", "main"]);
  for (let i = 1; i <= 24; i++) commit(repo, { message: `main work ${i}`, date: d(1, 10), files: { [`m${i}.txt`]: "x\n" } });
  git(repo, ["checkout", "-q", "feature/login"]);
  writeFileSync(`${repo}/base1.txt`, "changed\n");
  git(repo, ["stash", "push", "-q", "-m", "one"]);
  writeFileSync(`${repo}/base1.txt`, "changed again\n");
  git(repo, ["stash", "push", "-q", "-m", "two"]);
  await shot("build-horoscope", repo, { viewport: { width: 1000, height: 640 }, name: "build-horoscope", before: async ({ page, canvas }) => {
    await pause(800);
    await canvas.actions.find((a) => a.name === "deliver_reading").handler({ input: {
      text: "The Rubber Duck listens, but Mercury has gone retrograde: 24 commits behind main. Saturn has not heard from you in weeks, and two stashes lie buried.",
      nextStep: "Rebase onto main before lunch" } });
    await pause(600);
  } });
}

// 3. Standup Seance: yesterday's commits and a delivered standup.
{
  const repo = makeRepo({ name: "acme-api" });
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9);
  const msgs = ["Add retry to the upload client", "Fix flaky export test", 'Revert "Bump parser to 4.0"', "Document the config file", "Tidy the settings panel"];
  msgs.forEach((message, i) => commit(repo, { message, date: new Date(base.getTime() + i * 5400000).toISOString() }));
  commit(repo, { message: "Late fix for the nightly job", date: new Date(base.getFullYear(), base.getMonth(), base.getDate(), 1, 30).toISOString() });
  process.env.STANDUP_SEANCE_SETTINGS = `${repo}/.settings.json`;
  await shot("standup-seance", repo, { viewport: { width: 860, height: 900 }, name: "standup-seance", before: async ({ page, canvas }) => {
    await page.click("#summon");
    await pause(800);
    await canvas.actions.find((a) => a.name === "speak").handler({ input: {
      headline: "Shipped retries", done: ["Added retry handling to the upload client", "Stabilised the flaky export test", "Documented the config file and tidied settings"], next: ["Follow up on the parser bump"], blockers: [] } });
    await page.waitForSelector("#parchment", { state: "visible", timeout: 30000 });
  } });
}
console.log("mockups written to docs/mocks/");
