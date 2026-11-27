// Build Horoscope: a GitHub Copilot app canvas.
// Reads a branch's real git signals, casts a developer zodiac sign, shows a star-chart wheel,
// and lets the agent replace the rule-based reading with its own via `deliver_reading`.
//
// PLATFORM ASSUMPTIONS (unverified until the manual test, see docs/specs/platform-contract.md):
//   1. Workspace folder: workspacePath is not the repo; probe it, process.cwd(), env -> findRepo()
//   2. EventSource to the loopback server works in the canvas webview; the page
//      falls back to polling /signs when it errors                             -> PAGE (watch())
// Everything else here is plain Node.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { basename } from "node:path";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const run = promisify(execFile);
const DAY = 86400000;
let session = null;
let agentReading = null; // { branch, text, nextStep }
const servers = new Map(); // instanceId -> { server, url, token, clients }

let repoDir = null; // last folder confirmed to be a git work tree (display only)
const repoCache = new Map(); // candidate list -> resolved repo root

// session.workspacePath is the session's own folder, not the user's repo, and the host does not
// document the extension's cwd, so probe likely folders (see docs/specs/platform-contract.md).
export function candidateDirs() {
    const list = [session?.workspacePath, process.cwd(), process.env.INIT_CWD, process.env.PWD];
    return [...new Set(list.filter((d) => typeof d === "string" && d))];
}

export function describeGitError(error) {
    if (error.code === "ENOENT") return "git was not found on PATH";
    return (error.stderr || error.message || String(error)).toString().trim().split("\n")[0];
}

/** Resolves { dir } for the first candidate inside a git work tree, else { tried: [{ dir, why }] }. */
export async function findRepo() {
    const candidates = candidateDirs();
    const key = candidates.join("\u0000");
    if (repoCache.has(key)) return { dir: (repoDir = repoCache.get(key)) };
    const tried = [];
    for (const dir of candidates) {
        try {
            const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir, windowsHide: true });
            repoDir = stdout.trim() || dir;
            repoCache.set(key, repoDir);
            return { dir: repoDir };
        } catch (error) {
            tried.push({ dir, why: describeGitError(error) });
        }
    }
    repoDir = null;
    return { tried };
}

export const triedText = (tried) => tried.map((t) => `${t.dir}: ${t.why}`).join("; ");

function workspaceDir() {
    return repoDir || session?.workspacePath || process.cwd();
}

// ----------------------------------------------------------------------- git

/** Runs git; resolves stdout, or null when git exits non-zero (callers decide if that matters). */
async function git(args) {
    try {
        const { dir } = await findRepo();
        if (!dir) return null;
        const { stdout } = await run("git", ["--no-pager", ...args], {
            cwd: dir, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
        });
        return stdout;
    } catch (error) {
        if (error.code === "ENOENT") throw error;
        return null;
    }
}
const lines = (text) => (text ?? "").split("\n").filter(Boolean);
const days = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));

/** Local branches first, then remote-only ones (shown as "origin/x"); newest first within each group. */
export async function listBranches() {
    const refs = (prefix) => git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", prefix]);
    const local = lines(await refs("refs/heads"));
    const have = new Set(local);
    // Remote-tracking refs: drop "<remote>/HEAD" and any branch that also exists locally.
    const remote = lines(await refs("refs/remotes")).filter((r) => {
        if (!r.includes("/") || r.endsWith("/HEAD")) return false; // a bare "origin" is the symbolic HEAD
        return !have.has(r.slice(r.indexOf("/") + 1));
    });
    return [...local, ...remote];
}

async function resolveBase(branches) {
    const remote = (await git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]))?.trim();
    if (remote) return remote;
    for (const name of ["main", "master"]) if (branches.includes(name)) return name;
    return null;
}

// ------------------------------------------------------------------- zodiac

export const SIGNS = [
    ["The Null Pointer", "Points at nothing, with confidence"],
    ["The Rubber Duck", "Listens well, says little"],
    ["The Hotfix", "Fast, brave, rarely tested"],
    ["The Yak", "Started somewhere else entirely"],
    ["The Linter", "Has opinions about your whitespace"],
    ["The Race Condition", "Works on alternate Tuesdays"],
    ["The Monolith", "Large, loyal, hard to move"],
    ["The Fork", "Went its own way"],
    ["The Cache", "Remembers things that are no longer true"],
    ["The Deadlock", "Waiting for someone else to go first"],
    ["The Merge", "Brings people together, with conflicts"],
    ["The Legacy", "Nobody knows why it works"],
];
const NORTH_STAR = ["The North Star", "Steady, central, and entirely on trunk"];

/** Sign from the birth month in the commit's own timestamp string (no timezone conversion). */
export function signFor(birthIso) {
    const month = Number(String(birthIso).slice(5, 7));
    return month >= 1 && month <= 12 ? { index: month - 1, name: SIGNS[month - 1][0], trait: SIGNS[month - 1][1] } : { index: -1, name: "A Wandering Star", trait: "Born at an unknown time" };
}

// ------------------------------------------------------------------ planets

// threshold: where the planet crosses into trouble (the red arc of the wheel).
const PLANETS = [
    { key: "mercury", name: "Mercury", signal: "behind", threshold: 20 },
    { key: "venus", name: "Venus", signal: "dirty", threshold: 10 },
    { key: "mars", name: "Mars", signal: "lazy", threshold: 2 },
    { key: "jupiter", name: "Jupiter", signal: "ahead", threshold: 40 },
    { key: "saturn", name: "Saturn", signal: "syncDays", threshold: 14 },
    { key: "neptune", name: "Neptune", signal: "todoFiles", threshold: 25 },
    { key: "pluto", name: "Pluto", signal: "stashes", threshold: 3 },
    { key: "moon", name: "The Moon", signal: "idleDays", threshold: 7 },
];

const TEMPLATES = {
    mercury: (s, c) => `Mercury is in retrograde and so is your branch: ${s.behind} commits behind ${c.base}.`,
    venus: (s) => `Venus frets over ${s.dirty} uncommitted files and worries about attachment.`,
    mars: (s) => `Mars rushes in: ${s.lazy} commit messages say almost nothing.`,
    jupiter: (s) => `Jupiter expands, perhaps too far: ${s.ahead} commits ahead and counting.`,
    saturn: (s) => `Saturn notes you last synced ${s.syncDays} days ago and is not angry, only disappointed.`,
    neptune: (s) => `Neptune sees illusions in ${s.todoFiles} files marked TODO or FIXME.`,
    pluto: (s) => `${s.stashes} stashes lie buried. Pluto remembers every one.`,
    moon: (s) => `The Moon is new: ${s.idleDays} days since anyone touched this branch.`,
};
const AVOID = {
    mercury: "force-pushing", venus: "switching branches", mars: "typing 'wip' again", jupiter: "one more big commit",
    saturn: "merging without syncing first", neptune: "trusting the TODOs", pluto: "starting something new", moon: "promising a demo",
};

/** Planet states for the wheel; `over` is true past the threshold, `ratio` drives the angle. */
export function planetStates(signals, trunk) {
    // On trunk only the Moon (idle days), Venus (dirty files) and Pluto (stashes) speak.
    return PLANETS.filter((p) => !trunk || ["venus", "pluto", "moon"].includes(p.key)).map((p) => {
        const value = signals[p.signal] ?? 0;
        const over = value > p.threshold;
        return { key: p.key, name: p.name, signal: p.signal, value, threshold: p.threshold, ratio: value / p.threshold, over };
    });
}

/** Rule-based reading: one sentence per planet over threshold, most severe first, max three. */
export function instantReading(signals, base, trunk, now = Date.now()) {
    const planets = planetStates(signals, trunk);
    const hot = planets.filter((p) => p.over).sort((a, b) => b.ratio - a.ratio);
    const sentences = hot.slice(0, 3).map((p) => TEMPLATES[p.key](signals, { base }));
    if (!sentences.length) sentences.push("The stars are aligned. Suspicious. Check again after lunch.");
    return {
        sentences,
        luckyFile: signals.luckyFile || "none yet",
        luckyNumber: trunk ? signals.recentCommits ?? 0 : signals.ahead,
        avoidToday: hot.length ? AVOID[hot[0].key] : "nothing in particular",
    };
}

// ------------------------------------------------------------------ signals

export async function readSigns({ branch, now = new Date() } = {}) {
    const nowMs = now.getTime();
    const found = await findRepo();
    if (!found.dir) {
        throw Object.assign(new Error(`No git repository found. Tried ${triedText(found.tried)}`), { code: "NOT_REPO" });
    }
    const branches = await listBranches();
    const current = (await git(["symbolic-ref", "-q", "--short", "HEAD"]))?.trim() || null;
    const target = branch ?? current;
    if (branch != null && !branches.includes(branch)) {
        throw Object.assign(new Error(`unknown branch: ${branch}`), { code: "BAD_BRANCH" });
    }
    const ref = target ?? "HEAD";
    const base = await resolveBase(branches);
    const baseShort = base?.replace(/^origin\//, "");
    const trunk = !base || target === baseShort || target === base;
    const isCheckedOut = target === current;

    const s = { behind: 0, ahead: 0, syncDays: 0, idleDays: 0, branchAgeDays: 0, dirty: 0, stashes: 0, todoFiles: 0, lazy: 0, luckyFile: "", recentCommits: 0 };

    const tip = (await git(["log", "-1", "--format=%cI", ref]))?.trim();
    if (tip) s.idleDays = days(tip, nowMs);
    let birth = (await git(["log", "-1", "--format=%aI", ref]))?.trim() ?? "";

    if (!trunk) {
        const counts = (await git(["rev-list", "--left-right", "--count", `${base}...${ref}`]))?.trim().split(/\s+/).map(Number);
        if (counts?.length === 2) [s.behind, s.ahead] = counts; // behind first, ahead second
        const mergeBase = (await git(["merge-base", base, ref]))?.trim();
        if (mergeBase) {
            const syncDate = (await git(["log", "-1", "--format=%cI", mergeBase]))?.trim();
            if (syncDate) s.syncDays = days(syncDate, nowMs);
        }
        const own = lines(await git(["log", "--reverse", "--format=%aI", `${base}..${ref}`]));
        if (own.length) { birth = own[0]; s.branchAgeDays = days(own[0], nowMs); }
        const subjects = lines(await git(["log", "--format=%s", `${base}..${ref}`]));
        s.lazy = subjects.filter((x) => /^(wip|fix|tmp|asdf|\.)$/i.test(x.trim())).length;
        const freq = new Map();
        for (const f of lines(await git(["log", "--name-only", "--format=", `${base}..${ref}`]))) freq.set(f, (freq.get(f) ?? 0) + 1);
        s.luckyFile = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    } else {
        const since = new Date(nowMs - 7 * DAY).toISOString();
        s.recentCommits = lines(await git(["log", "--format=%h", `--since=${since}`, ref])).length;
        const freq = new Map();
        for (const f of lines(await git(["log", "--name-only", "--format=", `--since=${since}`, ref]))) freq.set(f, (freq.get(f) ?? 0) + 1);
        s.luckyFile = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    }

    // Working-tree signals only make sense for the checked-out branch.
    if (isCheckedOut) {
        s.dirty = lines(await git(["status", "--porcelain"])).length;
        s.stashes = lines(await git(["stash", "list"])).length;
    }
    // git grep exits 1 on no match: git() turns that into null, which counts as zero.
    s.todoFiles = lines(await git(["grep", "-c", "-I", "-E", "TODO|FIXME", ref, "--"])).length;

    return { branches, current, target, base: baseShort ?? null, trunk, detached: target == null, birth, signals: s, isCheckedOut };
}

/** Closest and furthest branch (ahead + behind) from `from`; looks at the 40 newest to bound git calls. */
export async function compatibility(from, branches) {
    const scored = [];
    for (const other of branches.slice(0, 40)) {
        if (other === from) continue;
        const counts = (await git(["rev-list", "--left-right", "--count", `${from}...${other}`]))?.trim().split(/\s+/).map(Number);
        if (counts?.length === 2) scored.push({ branch: other, distance: counts[0] + counts[1] });
    }
    if (!scored.length) return { most: null, least: null };
    scored.sort((a, b) => a.distance - b.distance || a.branch.localeCompare(b.branch));
    return { most: scored[0], least: scored.at(-1) };
}

export async function buildChart(branch, now = new Date()) {
    const r = await readSigns({ branch, now });
    const sign = r.trunk ? { index: -1, name: NORTH_STAR[0], trait: NORTH_STAR[1] } : r.detached ? { index: -1, name: "A Wandering Star", trait: "Belongs to no branch at all" } : signFor(r.birth);
    const label = r.target ?? "a wandering star";
    return {
        repo: basename(workspaceDir()),
        branch: label,
        base: r.base,
        trunk: r.trunk,
        detached: r.detached,
        branches: r.branches,
        sign,
        signals: r.signals,
        workingTree: r.isCheckedOut,
        planets: planetStates(r.signals, r.trunk),
        instant: instantReading(r.signals, r.base, r.trunk, now.getTime()),
        compat: r.target ? await compatibility(r.target, r.branches) : { most: null, least: null },
        reading: agentReading && agentReading.branch === label ? agentReading : null,
        generatedAt: now.toISOString(),
    };
}

async function safeChart(branch) {
    try {
        return await buildChart(branch);
    } catch (error) {
        const message = error.code === "ENOENT" ? "git was not found on PATH."
            : error.code === "NOT_REPO" ? `The stars have nothing to say: ${error.message}`
            : error.code === "BAD_BRANCH" ? `There is no branch called ${branch}.`
            : `The stars are clouded over: ${error.message}`;
        return { repo: basename(workspaceDir()), error: message, planets: [], branches: [] };
    }
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

/** The canvas never forwards file contents or diffs: numbers and branch names only. */
function readingPrompt(chart) {
    const facts = { branch: chart.branch, base: chart.base, sign: chart.sign.name, trunk: chart.trunk, signals: chart.signals };
    return `Use the mb-cast-build-horoscope skill. Signals: ${JSON.stringify(facts)}`;
}

async function route(request, response, entry) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.searchParams.get("t") !== entry.token) return sendJson(response, 403, { error: "Forbidden." });
    if (url.pathname === "/" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(PAGE);
    }
    if (url.pathname === "/signs" && request.method === "GET") {
        return sendJson(response, 200, await safeChart(url.searchParams.get("branch") || undefined));
    }
    if (url.pathname === "/events" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        response.write(": connected\n\n");
        entry.clients.add(response);
        request.on("close", () => entry.clients.delete(response));
        return;
    }
    if (url.pathname === "/refresh" && request.method === "POST") {
        const { branch } = await readJson(request);
        const chart = await safeChart(typeof branch === "string" && branch ? branch : undefined);
        broadcast({ type: "refresh" });
        if (!chart.error) await session.send({ prompt: readingPrompt(chart) });
        return sendJson(response, 202, { ok: true });
    }
    sendJson(response, 404, { error: "Not found." });
}

async function startServer() {
    const entry = { token: randomUUID(), clients: new Set(), server: null, url: null };
    entry.server = createServer((request, response) => {
        route(request, response, entry).catch((error) => {
            void session?.log(`Build Horoscope error: ${error.message}`, { level: "error" });
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

async function currentLabel() {
    return (await git(["symbolic-ref", "-q", "--short", "HEAD"]))?.trim() || "a wandering star";
}

const clip = (value, max) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const branchInput = { type: "object", properties: { branch: { type: "string", description: "Local branch name (defaults to the current branch)." } }, additionalProperties: false };

const canvas = createCanvas({
    id: "build-horoscope",
    displayName: "Build Horoscope",
    description: "A daily horoscope for the current git branch, drawn on a star-chart wheel from real git signals.",
    actions: [
        {
            name: "read_signs",
            description: "Return the branch's zodiac sign and every signal value so a horoscope can be written.",
            inputSchema: branchInput,
            handler: async (ctx) => {
                const chart = await safeChart(ctx.input?.branch);
                if (chart.error) return { error: chart.error };
                return { branch: chart.branch, base: chart.base, trunk: chart.trunk, sign: chart.sign, signals: chart.signals,
                    planets: chart.planets.map(({ name, value, threshold, over }) => ({ name, value, threshold, over })),
                    instant: chart.instant, compat: chart.compat };
            },
        },
        {
            name: "deliver_reading",
            description: "Show the agent-written horoscope in the canvas panel, replacing the rule-based one.",
            inputSchema: {
                type: "object",
                properties: {
                    text: { type: "string", maxLength: 400, description: "The horoscope, at most 60 words." },
                    nextStep: { type: "string", maxLength: 120, description: "One concrete next step." },
                    branch: { type: "string", description: "Branch the reading is for (defaults to the current branch)." },
                },
                required: ["text", "nextStep"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                agentReading = { branch: ctx.input?.branch || (await currentLabel()), text: clip(ctx.input?.text, 400), nextStep: clip(ctx.input?.nextStep, 120) };
                broadcast({ type: "reading", ...agentReading });
                return { delivered: true };
            },
        },
        {
            name: "refresh",
            description: "Recompute the signals and redraw the wheel.",
            inputSchema: branchInput,
            handler: async (ctx) => {
                const chart = await safeChart(ctx.input?.branch);
                broadcast({ type: "refresh" });
                return chart.error ? { error: chart.error } : { branch: chart.branch, sign: chart.sign.name };
            },
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer();
            servers.set(ctx.instanceId, entry);
        }
        return { title: "Build Horoscope", status: basename(workspaceDir()), url: entry.url };
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
<title>Build Horoscope</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0a1a; color: #e6e2ff; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }
  body { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(260px, 340px); gap: 12px; padding: 12px; box-sizing: border-box; }
  @media (max-width: 640px) { body { grid-template-columns: 1fr; grid-auto-rows: min-content; overflow: auto; } }
  #wheel { width: 100%; aspect-ratio: 1; max-height: calc(100vh - 24px); justify-self: center; }
  aside { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  h1 { margin: 0; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #9d94d6; }
  h2 { margin: 0; font-size: 20px; }
  #trait { color: #a9a1dc; font-style: italic; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  select, button { font: inherit; color: #e6e2ff; background: rgba(140,120,230,.16); border: 1px solid rgba(170,150,255,.35); border-radius: 6px; padding: 4px 10px; max-width: 100%; }
  button { cursor: pointer; } button:hover { background: rgba(140,120,230,.3); }
  button:focus-visible, select:focus-visible { outline: 2px solid #b9acff; outline-offset: 2px; }
  #reading p { margin: 0 0 6px; }
  #next { color: #ffd98a; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  dt { color: #9d94d6; } dd { margin: 0; overflow-wrap: anywhere; }
  #source { color: #9d94d6; font-size: 11px; }
  #error { display: none; padding: 16px; color: #ffb0b0; }
</style>
</head>
<body>
<canvas id="wheel" width="600" height="600" aria-label="Star chart of branch signals"></canvas>
<aside>
  <h1 id="where">Build Horoscope</h1>
  <div id="error" role="alert"></div>
  <div id="main">
    <h2 id="sign"></h2><div id="trait"></div>
    <div class="row"><select id="branch" aria-label="Branch to read"></select><button id="refresh" type="button">Ask the stars again</button></div>
    <div id="reading"></div>
    <div id="source"></div>
    <dl id="facts"></dl>
    <dl id="compat"></dl>
  </div>
</aside>
<script>
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var token = q.get("t");
  var cv = document.getElementById("wheel"), g = cv.getContext("2d");
  var el = function (id) { return document.getElementById(id); };
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var chart = null, frame = 0, selected = "";
  var SIGNS = ["Null Pointer","Rubber Duck","Hotfix","Yak","Linter","Race Condition","Monolith","Fork","Cache","Deadlock","Merge","Legacy"];

  function url(path, extra) {
    var p = new URLSearchParams({ t: token });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) p.set(k, extra[k]); });
    return path + "?" + p.toString();
  }
  function add(parent, tag, text, cls) {
    var n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; parent.appendChild(n); return n;
  }
  function facts(dl, pairs) {
    dl.textContent = "";
    pairs.forEach(function (p) { add(dl, "dt", p[0]); add(dl, "dd", p[1]); });
  }

  function load() {
    return fetch(url("/signs", { branch: selected })).then(function (r) { return r.json(); }).then(function (c) {
      chart = c; render();
    }).catch(function () { showError("The observatory is closed (could not load data)."); });
  }
  function showError(msg) {
    el("error").style.display = "block"; el("error").textContent = msg; el("main").style.display = "none";
  }

  function render() {
    if (chart.error) { showError(chart.error); return; }
    el("error").style.display = "none"; el("main").style.display = "block";
    el("where").textContent = chart.repo + " / " + chart.branch;
    el("sign").textContent = chart.sign.name;
    el("trait").textContent = chart.sign.trait;
    var sel = el("branch"); sel.textContent = "";
    chart.branches.forEach(function (b) { var o = add(sel, "option", b); o.value = b; if (b === chart.branch) o.selected = true; });
    var box = el("reading"); box.textContent = "";
    var r = chart.reading;
    if (r) { add(box, "p", r.text); add(box, "p", "Next step: " + r.nextStep, "").id = "next"; el("source").textContent = "Reading by Copilot"; }
    else { chart.instant.sentences.forEach(function (s) { add(box, "p", s); }); el("source").textContent = "Rule-based reading. Press the button to ask Copilot."; }
    facts(el("facts"), [
      ["Lucky file", chart.instant.luckyFile], ["Lucky number", String(chart.instant.luckyNumber)], ["Avoid today", chart.instant.avoidToday]
    ]);
    var c = chart.compat, pairs = [];
    if (c.most) pairs.push(["Most compatible", c.most.branch + " (distance " + c.most.distance + ")"]);
    if (c.least) pairs.push(["Least compatible", c.least.branch + " (distance " + c.least.distance + ")"]);
    facts(el("compat"), pairs);
  }

  function polar(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }

  function draw() {
    frame++;
    var W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W * 0.47;
    g.clearRect(0, 0, W, H);
    var bg = g.createRadialGradient(cx, cy, 0, cx, cy, R); bg.addColorStop(0, "#1a1540"); bg.addColorStop(1, "#0b0a1a");
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.fill();
    // Twelve zodiac segments; the branch's sign is lit.
    for (var i = 0; i < 12; i++) {
      var a0 = -Math.PI / 2 + i * Math.PI / 6, a1 = a0 + Math.PI / 6;
      var on = chart && chart.sign && chart.sign.index === i;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
      g.fillStyle = on ? "rgba(255,217,138,.22)" : "rgba(140,120,230,.04)"; g.fill();
      g.strokeStyle = "rgba(170,150,255,.25)"; g.stroke();
      var m = polar(cx, cy, R * 0.93, (a0 + a1) / 2);
      g.fillStyle = on ? "#ffd98a" : "rgba(200,190,255,.55)"; g.font = "11px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(SIGNS[i], m[0], m[1]);
    }
    if (!chart || chart.error) { requestAnimationFrame(draw); return; }
    var planets = chart.planets, n = planets.length;
    planets.forEach(function (p, k) {
      var orbit = R * (0.2 + 0.6 * (k + 1) / n);
      g.strokeStyle = "rgba(170,150,255,.18)"; g.beginPath(); g.arc(cx, cy, orbit, 0, 6.2832); g.stroke();
      // Red arc: the last third of the orbit is where the signal has crossed its threshold.
      g.strokeStyle = "rgba(255,90,90,.35)"; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, orbit, Math.PI * 2 / 3 * 2 - Math.PI / 2, Math.PI * 1.5); g.stroke(); g.lineWidth = 1;
      var frac = Math.min(1.5, p.ratio) / 1.5; // 0..threshold fills two thirds, beyond into the red third
      var wobble = calm ? 0 : Math.sin(frame * 0.02 + k) * 0.03;
      if (p.key === "mercury" && p.over && !calm) wobble = -((frame * 0.004) % 0.6); // retrograde
      var pos = polar(cx, cy, orbit, -Math.PI / 2 + frac * Math.PI * 2 + wobble);
      g.fillStyle = p.over ? "#ff7a7a" : "#9be3ff"; g.beginPath(); g.arc(pos[0], pos[1], 7, 0, 6.2832); g.fill();
      g.fillStyle = "#e6e2ff"; g.font = "10px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "left";
      g.fillText(p.name + (p.key === "mercury" && p.over ? " (Rx)" : ""), pos[0] + 10, pos[1]);
    });
    g.fillStyle = "#ffd98a"; g.beginPath(); g.arc(cx, cy, 9, 0, 6.2832); g.fill();
    requestAnimationFrame(draw);
  }

  el("branch").addEventListener("change", function () { selected = this.value; load(); });
  el("refresh").addEventListener("click", function () {
    fetch(url("/refresh"), { method: "POST", body: JSON.stringify({ branch: selected }) });
  });

  // Live updates: SSE first; if the webview refuses EventSource, poll /signs instead.
  var poller = null, stamp = "";
  function poll() {
    fetch(url("/signs", { branch: selected })).then(function (r) { return r.json(); }).then(function (c) {
      var next = (c.reading ? c.reading.text : "") + "|" + (c.generatedAt || "");
      if (stamp && next.split("|")[0] !== stamp.split("|")[0]) { chart = c; render(); }
      stamp = next;
    }).catch(function () {});
  }
  function watch() {
    if (typeof EventSource === "undefined") { poller = setInterval(poll, 5000); poll(); return; }
    var events = new EventSource(url("/events"));
    events.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "refresh") load();
      if (msg.type === "reading" && chart && msg.branch === chart.branch) { chart.reading = msg; render(); }
    };
    events.onerror = function () { if (!poller) { poller = setInterval(poll, 5000); poll(); } };
  }
  watch(); load(); requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;

session = await joinSession({ canvases: [canvas] });
