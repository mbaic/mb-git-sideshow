// Standup Seance: a GitHub Copilot app canvas.
// A spirit board summons your recent commits (local git, all branches) and spells out
// your standup. The agent writes the standup and delivers it with the `speak` action.
//
// PLATFORM ASSUMPTIONS (unverified until the manual test, see docs/specs/platform-contract.md):
//   1. Workspace folder: session.workspacePath, falling back to process.cwd()  -> workspaceDir()
//   2. Per-user settings live in $COPILOT_HOME/extensions/standup-seance/       -> settingsPath()
//   3. EventSource to the loopback server works in the canvas webview; the page
//      falls back to polling /state when it errors                              -> PAGE (watch())
// Everything else here is plain Node.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const run = promisify(execFile);
const MAX_COMMITS_TO_AGENT = 100;
let session = null;
const servers = new Map(); // instanceId -> { server, url, token, clients }
const state = { speech: null, whispers: null }; // last speech and last lookup, for polling clients

function workspaceDir() {
    return session?.workspacePath || process.cwd();
}

function settingsPath() {
    if (process.env.STANDUP_SEANCE_SETTINGS) return process.env.STANDUP_SEANCE_SETTINGS;
    const home = process.env.COPILOT_HOME || join(homedir(), ".copilot");
    return join(home, "extensions", "standup-seance", "settings.json");
}

// ----------------------------------------------------------------- settings

// Strict on purpose: these end up in a git argument list. (execFile means no shell either way.)
const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const isEmail = (value) => typeof value === "string" && value.length <= 254 && EMAIL.test(value);

export async function loadSettings() {
    try {
        const raw = JSON.parse(await readFile(settingsPath(), "utf8"));
        return { emails: [...new Set((raw.emails ?? []).filter(isEmail))] };
    } catch {
        return { emails: [] };
    }
}

export async function saveSettings(input) {
    const emails = [...new Set((input?.emails ?? []).map((e) => String(e).trim()).filter(Boolean))];
    const bad = emails.find((e) => !isEmail(e));
    if (bad) throw Object.assign(new Error(`Not a valid email address: ${bad.slice(0, 60)}`), { status: 400 });
    const settings = { emails };
    await mkdir(dirname(settingsPath()), { recursive: true });
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
    return settings;
}

// ------------------------------------------------------------------- ranges

/** Tests swap this to pin "today". */
export const clock = { now: () => new Date() };

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

/**
 * Windows in the local time zone.
 * yesterday: previous calendar day; on Monday it widens to Friday 00:00 through Monday 00:00.
 * week: 00:00 six days ago through now.
 */
export function windowFor(range, now = new Date()) {
    const today = startOfDay(now);
    if (range === "yesterday") {
        const monday = now.getDay() === 1;
        return { range, label: monday ? "Yesterday (Friday to Sunday)" : "Yesterday", start: addDays(today, monday ? -3 : -1), end: today };
    }
    if (range === "week") {
        return { range, label: "Last 7 days", start: addDays(today, -6), end: new Date(now.getTime() + 1) };
    }
    throw Object.assign(new Error(`Unknown range: ${range}`), { status: 400 });
}

// ------------------------------------------------------------------- lookup

async function git(args) {
    const { stdout } = await run("git", ["--no-pager", ...args], { cwd: workspaceDir(), maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return stdout;
}

/** Hour and weekday come from the commit's own timestamp text, not the viewer's zone. */
export function flagsFor(commit) {
    const hour = Number(commit.date.slice(11, 13));
    const weekday = new Date(Date.UTC(+commit.date.slice(0, 4), +commit.date.slice(5, 7) - 1, +commit.date.slice(8, 10))).getUTCDay();
    const flags = [];
    if (/^revert\b/i.test(commit.subject)) flags.push("a restless spirit");
    if (hour < 4) flags.push("witching hour");
    if (weekday === 5 && hour >= 15) flags.push("a brave soul");
    return flags;
}

/**
 * Two steps. (1) git prefilter: --all, no merges, author emails, --since only (a commit's committer
 * date is never earlier than its author date, so this is a superset). (2) exact filter in Node on the
 * AUTHOR date window, then de-duplicate rebased copies by authorDate + subject.
 */
export async function lookup(range, { now = new Date(), extraEmails } = {}) {
    const win = windowFor(range, now);
    const settings = extraEmails ? { emails: extraEmails } : await loadSettings();
    let own = "";
    try {
        own = (await git(["config", "user.email"])).trim();
    } catch (error) {
        if (error.code === "ENOENT") throw Object.assign(new Error("git was not found on PATH."), { code: "NO_GIT" });
    }
    const emails = [...new Set([own, ...settings.emails].filter(isEmail))];
    if (!emails.length) throw Object.assign(new Error("No email to look for: set git config user.email or add one in the settings."), { code: "NO_EMAIL" });
    const wanted = new Set(emails.map((e) => e.toLowerCase()));

    let stdout;
    try {
        stdout = await git([
            "log", "--all", "--no-merges", "--fixed-strings",
            ...emails.map((e) => `--author=<${e}>`),
            `--since=${win.start.toISOString()}`,
            "--pretty=format:%x1e%h%x1f%aI%x1f%ae%x1f%s",
        ]);
    } catch (error) {
        if (error.code === "ENOENT") throw Object.assign(new Error("git was not found on PATH."), { code: "NO_GIT" });
        // An empty repository (no commits) also lands here.
        throw Object.assign(new Error("not a git repository, or it has no commits"), { code: "NOT_REPO" });
    }

    const seen = new Set();
    const commits = [];
    for (const record of stdout.split("\x1e").slice(1)) {
        const [hash, date, email, subject = ""] = record.replace(/\n$/, "").split("\x1f");
        if (!wanted.has(email.toLowerCase())) continue; // git's match is a substring match; be exact
        const when = Date.parse(date);
        if (!(when >= win.start.getTime() && when < win.end.getTime())) continue;
        const key = `${date}\u0000${subject}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const commit = { hash, date, subject };
        commit.flags = flagsFor(commit);
        commits.push(commit);
    }
    commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { range, label: win.label, since: win.start.toISOString(), repo: basename(workspaceDir()), commits };
}

/** Commit subjects grouped by author-local day, newest day first. */
export function groupByDay(commits) {
    const days = new Map();
    for (const c of commits) {
        const day = c.date.slice(0, 10);
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(c.subject);
    }
    return [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, subjects]) => ({ day, subjects }));
}

/** Subjects only: no diffs, no emails, no hashes. */
export function seancePrompt(result) {
    const days = groupByDay(result.commits.slice(0, MAX_COMMITS_TO_AGENT)).map((d) => ({ day: d.day, subjects: d.subjects.map((s) => s.slice(0, 200)) }));
    return `Use the hold-standup-seance skill. Range: ${result.label}. Commits by day: ${JSON.stringify(days)}`;
}

async function safeLookup(range) {
    try {
        return await lookup(range, { now: clock.now() });
    } catch (error) {
        const message = error.code === "NOT_REPO" ? "This folder is not a git repository (or has no commits), so the spirits have nothing to say."
            : error.message;
        return { range, error: message, commits: [], repo: basename(workspaceDir()) };
    }
}

// ------------------------------------------------------------------- speech

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []).map((x) => clip(x, 200)).filter(Boolean).slice(0, 8);

/** The board only has A-Z and 0-9: keep letters, digits and spaces, upper-cased, max 40. */
export function cleanHeadline(value) {
    return String(value ?? "").normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
}

export function cleanSpeech(input) {
    return { headline: cleanHeadline(input?.headline) || "THE SPIRITS HAVE SPOKEN", done: list(input?.done), next: list(input?.next), blockers: list(input?.blockers) };
}

// ------------------------------------------------------------- local server

function broadcast(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const entry of servers.values()) for (const client of entry.clients) client.write(line);
}
function sendJson(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}
async function readJson(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw Object.assign(new Error("Request body too large."), { status: 413 });
    }
    try { return JSON.parse(body || "{}"); } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}

async function route(request, response, entry) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.searchParams.get("t") !== entry.token) return sendJson(response, 403, { error: "Forbidden." });
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/" && method === "GET") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(PAGE);
    }
    if (pathname === "/state" && method === "GET") return sendJson(response, 200, state);
    if (pathname === "/events" && method === "GET") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        response.write(": connected\n\n");
        entry.clients.add(response);
        request.on("close", () => entry.clients.delete(response));
        return;
    }
    if (pathname === "/summon" && method === "POST") {
        const { range } = await readJson(request);
        windowFor(range, clock.now()); // validates
        const result = await safeLookup(range);
        state.whispers = result;
        state.speech = null;
        if (!result.error && result.commits.length) await session.send({ prompt: seancePrompt(result) });
        return sendJson(response, 200, result);
    }
    if (pathname === "/settings" && method === "GET") return sendJson(response, 200, await loadSettings());
    if (pathname === "/settings" && method === "POST") return sendJson(response, 200, await saveSettings(await readJson(request)));
    sendJson(response, 404, { error: "Not found." });
}

async function startServer() {
    const entry = { token: randomUUID(), clients: new Set(), server: null, url: null };
    entry.server = createServer((request, response) => {
        route(request, response, entry).catch((error) => {
            void session?.log(`Standup Seance error: ${error.message}`, { level: "error" });
            if (!response.headersSent) sendJson(response, error.status ?? 500, { error: error.message });
            else response.end();
        });
    });
    await new Promise((resolve, reject) => {
        entry.server.once("error", reject);
        entry.server.listen(0, "127.0.0.1", resolve);
    });
    entry.url = `http://127.0.0.1:${entry.server.address().port}/?t=${entry.token}`;
    return entry;
}

// ------------------------------------------------------------------- canvas

const rangeSchema = { type: "string", enum: ["yesterday", "week"], description: "yesterday, or week for the last 7 days." };

const canvas = createCanvas({
    id: "standup-seance",
    displayName: "Standup Seance",
    description: "A spirit board that summons your recent commits and spells out your standup update.",
    actions: [
        {
            name: "read_whispers",
            description: "Return the user's commits for a range so the standup can be written.",
            inputSchema: { type: "object", properties: { range: rangeSchema }, required: ["range"], additionalProperties: false },
            handler: async (ctx) => {
                const result = await safeLookup(ctx.input?.range ?? "yesterday");
                state.whispers = result;
                return { range: result.range, label: result.label, error: result.error, commits: result.commits.map(({ date, subject, flags }) => ({ date, subject, flags })) };
            },
        },
        {
            name: "speak",
            description: "Deliver the standup: the board spells the headline and the parchment shows the update.",
            inputSchema: {
                type: "object",
                properties: {
                    headline: { type: "string", maxLength: 40, description: "At most 40 characters: letters, digits and spaces only." },
                    done: { type: "array", items: { type: "string" } },
                    next: { type: "array", items: { type: "string" } },
                    blockers: { type: "array", items: { type: "string" } },
                },
                required: ["headline", "done", "next", "blockers"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                state.speech = cleanSpeech(ctx.input);
                broadcast({ type: "speak", ...state.speech });
                return { spoken: true, headline: state.speech.headline };
            },
        },
        {
            name: "summon",
            description: "Show the commits on the board for a range, as if the Summon button were pressed (does not prompt the agent).",
            inputSchema: { type: "object", properties: { range: rangeSchema }, required: ["range"], additionalProperties: false },
            handler: async (ctx) => {
                const result = await safeLookup(ctx.input?.range ?? "yesterday");
                state.whispers = result;
                state.speech = null;
                broadcast({ type: "summon", whispers: result });
                return { range: result.range, label: result.label, error: result.error, count: result.commits.length };
            },
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer();
            servers.set(ctx.instanceId, entry);
        }
        return { title: "Standup Seance", status: basename(workspaceDir()), url: entry.url };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        for (const client of entry.clients) client.end();
        await new Promise((resolve) => entry.server.close(resolve));
    },
});

// ----------------------------------------------------------------- the page
// String.raw keeps backslashes intact. The client script avoids template literals so
// nothing in it is interpolated by this module. All repo text goes through textContent / fillText.

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Standup Seance</title>
<style>
  html, body { margin: 0; background: #120d0a; color: #f0e2c8; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }
  body { display: flex; flex-direction: column; gap: 10px; padding: 12px; box-sizing: border-box; min-height: 100vh; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #c9a86a; flex: 1; }
  select, button, textarea { font: inherit; color: #f0e2c8; background: rgba(201,168,106,.14); border: 1px solid rgba(201,168,106,.4); border-radius: 6px; padding: 4px 10px; }
  button { cursor: pointer; } button:hover { background: rgba(201,168,106,.28); }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #ffd98a; outline-offset: 2px; }
  #board { width: 100%; max-width: 760px; align-self: center; aspect-ratio: 16 / 10; }
  #message { text-align: center; color: #c9a86a; min-height: 1.4em; }
  #whispers { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }
  #whispers li { overflow-wrap: anywhere; }
  .flag { color: #c9a86a; font-style: italic; margin-left: 6px; }
  .day { color: #c9a86a; margin-top: 6px; }
  #parchment { display: none; padding: 12px 14px; border-radius: 8px; color: #2b1d0e; background: #e9d8b0; }
  #parchment h2 { margin: 0 0 6px; font-size: 15px; }
  #parchment h3 { margin: 8px 0 2px; font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
  #parchment ul { margin: 0; padding-left: 18px; }
  #parchment button { color: #2b1d0e; background: rgba(43,29,14,.1); border-color: rgba(43,29,14,.4); margin-top: 8px; }
  details { color: #c9a86a; } textarea { width: 100%; box-sizing: border-box; min-height: 4em; }
</style>
</head>
<body>
<div class="row">
  <h1 id="repo">Standup Seance</h1>
  <select id="range" aria-label="Range"><option value="yesterday">Yesterday</option><option value="week">Last 7 days</option></select>
  <button id="summon" type="button">Summon</button>
</div>
<canvas id="board" width="800" height="500" aria-label="Spirit board"></canvas>
<div id="message" role="status"></div>
<div id="parchment"><h2 id="headline"></h2><div id="body"></div><button id="copy" type="button">Copy</button></div>
<div><ul id="whispers"></ul></div>
<details><summary>Extra email addresses</summary>
  <p>Commits made through the GitHub web UI or squash merges often carry a noreply address. One per line.</p>
  <textarea id="emails" aria-label="Extra email addresses"></textarea>
  <div class="row"><button id="save" type="button">Save</button><span id="saved"></span></div>
</details>
<script>
(function () {
  "use strict";
  var token = new URLSearchParams(location.search).get("t");
  var cv = document.getElementById("board"), g = cv.getContext("2d");
  var el = function (id) { return document.getElementById(id); };
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var frame = 0, candles = 0, plan = { x: 0.5, y: 0.5 }, queue = [], wait = 0, speech = null, lastSpeech = "";

  function url(path) { return path + "?t=" + encodeURIComponent(token); }
  function post(path, body) {
    return fetch(url(path), { method: "POST", body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; });
    });
  }
  function add(parent, tag, text, cls) {
    var n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; parent.appendChild(n); return n;
  }

  // ---- board geometry (unit square) ----
  var pos = {};
  (function () {
    var a = "ABCDEFGHIJKLM", b = "NOPQRSTUVWXYZ", i;
    for (i = 0; i < 13; i++) {
      var f = i / 12;
      pos[a[i]] = { x: 0.12 + f * 0.76, y: 0.46 - Math.sin(f * Math.PI) * 0.08 };
      pos[b[i]] = { x: 0.12 + f * 0.76, y: 0.62 - Math.sin(f * Math.PI) * 0.08 };
    }
    for (i = 0; i < 10; i++) pos[String(i)] = { x: 0.2 + i * 0.067, y: 0.77 };
    pos.YES = { x: 0.16, y: 0.16 }; pos.NO = { x: 0.84, y: 0.16 }; pos.GOODBYE = { x: 0.5, y: 0.92 }; pos.REST = { x: 0.5, y: 0.34 };
  })();

  function spell(text) {
    queue = [];
    if (calm) { plan = pos.GOODBYE; return; }
    text.split("").forEach(function (ch) { queue.push(ch === " " ? "REST" : ch); });
    queue.push("GOODBYE");
    wait = 0;
  }

  function draw() {
    frame++;
    var W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    var wood = g.createLinearGradient(0, 0, W, H); wood.addColorStop(0, "#3a2614"); wood.addColorStop(1, "#24160b");
    g.fillStyle = wood; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(201,168,106,.5)"; g.lineWidth = 3; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = "#e0c58e"; g.textAlign = "center"; g.textBaseline = "middle";
    Object.keys(pos).forEach(function (k) {
      if (k === "REST") return;
      var p = pos[k], big = k.length > 1;
      g.font = (big ? "600 22px" : "600 24px") + " Georgia, serif";
      g.fillText(k, p.x * W, p.y * H);
    });
    // Candles, one per commit up to 13.
    for (var c = 0; c < candles; c++) {
      var cx = W * (0.08 + c * 0.07), cy = H * 0.97 - 14;
      g.fillStyle = "#efe4c7"; g.fillRect(cx - 3, cy, 6, 16);
      var fl = calm ? 0 : Math.sin(frame * 0.2 + c * 1.7) * 2;
      g.fillStyle = "rgba(255,190,80,.95)"; g.beginPath(); g.ellipse(cx + fl * 0.3, cy - 4, 3, 6 + fl, 0, 0, 6.2832); g.fill();
    }
    // Planchette: eases toward the current target, pauses on each letter.
    if (!calm) {
      if (wait > 0) wait--;
      else if (queue.length) {
        var target = pos[queue[0]] || pos.REST, dx = target.x - plan.x, dy = target.y - plan.y;
        if (Math.abs(dx) + Math.abs(dy) < 0.004) { plan = { x: target.x, y: target.y }; queue.shift(); wait = 9; }
        else plan = { x: plan.x + dx * 0.22, y: plan.y + dy * 0.22 };
      } else if (!speech) {
        plan = { x: plan.x + Math.sin(frame * 0.013) * 0.0006, y: plan.y + Math.cos(frame * 0.011) * 0.0006 };
      }
    }
    var px = plan.x * W, py = plan.y * H;
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(px + 6, py + 8, 34, 28, 0, 0, 6.2832); g.fill();
    g.fillStyle = "rgba(240,226,200,.88)"; g.beginPath(); g.moveTo(px, py - 34); g.lineTo(px + 30, py + 24); g.lineTo(px - 30, py + 24); g.closePath(); g.fill();
    g.fillStyle = "#120d0a"; g.beginPath(); g.arc(px, py + 2, 8, 0, 6.2832); g.fill();
    requestAnimationFrame(draw);
  }

  // ---- whispers and speech ----
  function showWhispers(w) {
    var ul = el("whispers"); ul.textContent = "";
    el("repo").textContent = "Standup Seance" + (w.repo ? " / " + w.repo : "");
    if (w.error) { el("message").textContent = w.error; candles = 0; plan = pos.NO; return; }
    candles = Math.min(13, w.commits.length);
    if (!w.commits.length) {
      el("message").textContent = "The spirits are silent. Did you work " + (w.range === "week" ? "this week" : "yesterday") + "?";
      queue = []; plan = pos.NO; return;
    }
    el("message").textContent = w.label + ": " + w.commits.length + " commits. Raw whispers below.";
    var day = "";
    w.commits.forEach(function (c) {
      if (c.date.slice(0, 10) !== day) { day = c.date.slice(0, 10); add(ul, "li", day, "day"); }
      var li = add(ul, "li", c.hash + "  " + c.subject);
      c.flags.forEach(function (f) { add(li, "span", f, "flag"); });
    });
    spell("THEY COME");
  }

  function showSpeech(s) {
    speech = s;
    el("headline").textContent = s.headline;
    var body = el("body"); body.textContent = "";
    [["Done", s.done], ["Next", s.next], ["Blockers", s.blockers]].forEach(function (part) {
      if (!part[1].length) return;
      add(body, "h3", part[0]);
      var ul = add(body, "ul", ""); part[1].forEach(function (t) { add(ul, "li", t); });
    });
    if (calm) { el("parchment").style.display = "block"; plan = pos.GOODBYE; return; }
    el("parchment").style.display = "none";
    spell(s.headline);
    // The parchment fades in once the headline is spelled (the queue empties).
    var started = Date.now();
    var timer = setInterval(function () {
      if ((!queue.length && wait === 0) || Date.now() - started > 20000) { clearInterval(timer); el("parchment").style.display = "block"; }
    }, 200);
  }
  function plainText() {
    if (!speech) return "";
    var out = [speech.headline];
    [["Done", speech.done], ["Next", speech.next], ["Blockers", speech.blockers]].forEach(function (p) {
      if (p[1].length) { out.push("", p[0] + ":"); p[1].forEach(function (t) { out.push("- " + t); }); }
    });
    return out.join("\n");
  }
  el("copy").addEventListener("click", function () {
    var text = plainText(), btn = this;
    function done() { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "Copy failed"; }
      document.body.removeChild(ta);
    }
  });

  el("summon").addEventListener("click", function () {
    var btn = this; btn.disabled = true; speech = null; el("parchment").style.display = "none";
    el("message").textContent = "Gathering the spirits...";
    post("/summon", { range: el("range").value }).then(showWhispers).catch(function (e) { el("message").textContent = e.message; })
      .then(function () { btn.disabled = false; });
  });

  // ---- settings ----
  fetch(url("/settings")).then(function (r) { return r.json(); }).then(function (s) { el("emails").value = (s.emails || []).join("\n"); }).catch(function () {});
  el("save").addEventListener("click", function () {
    var emails = el("emails").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    post("/settings", { emails: emails }).then(function () { el("saved").textContent = "Saved"; }).catch(function (e) { el("saved").textContent = e.message; });
  });

  // ---- live updates: SSE first; if the webview refuses EventSource, poll /state ----
  var poller = null;
  function apply(msg) {
    if (msg.type === "speak") showSpeech(msg);
    if (msg.type === "summon") showWhispers(msg.whispers);
  }
  function poll() {
    fetch(url("/state")).then(function (r) { return r.json(); }).then(function (s) {
      if (s.speech && s.speech.headline + s.speech.done.join() !== lastSpeech) { lastSpeech = s.speech.headline + s.speech.done.join(); showSpeech(s.speech); }
    }).catch(function () {});
  }
  function watch() {
    if (typeof EventSource === "undefined") { poller = setInterval(poll, 3000); return; }
    var events = new EventSource(url("/events"));
    events.onmessage = function (e) { apply(JSON.parse(e.data)); };
    events.onerror = function () { if (!poller) poller = setInterval(poll, 3000); };
  }
  watch(); plan = pos.REST; requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;

session = await joinSession({ canvases: [canvas] });
