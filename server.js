import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "dist");

// Settings come from the real environment first; .env fills in anything unset,
// so `npm start`, pm2 and systemd all read the same file.
try {
  process.loadEnvFile(join(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);
const herdrBin = process.env.HERDR_BIN || "herdr";
const token = process.env.HERDR_REMOTE_TOKEN || "";
const allowedHosts = new Set(
  (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

// Security boundary, not a convenience: this server is reachable across the
// tailnet and `herdr pane send-keys` drives live agent sessions, so only these
// exact key names may ever reach the CLI. Never widen to arbitrary input.
// Ctrl chords are enumerated ctrl+a..ctrl+z (herdr's own key syntax), not a
// pattern — note ctrl+d sends EOF and will exit a bare shell.
const ALLOWED_PANE_KEYS = new Set([
  "Up",
  "Down",
  "Left",
  "Right",
  "Enter",
  "Escape",
  "Tab",
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((letter) => `ctrl+${letter}`)
]);
const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function send(res, status, body, headers = jsonHeaders) {
  res.writeHead(status, headers);
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

function tokenMatches(candidate) {
  if (typeof candidate !== "string") return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(token));
}

// The query-string token exists only because EventSource cannot set headers,
// so it is honoured for the stream endpoint alone.
function isAuthed(req, url, { allowQueryToken = false } = {}) {
  if (!token) return true;
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ") && tokenMatches(header.slice(7))) return true;
  return allowQueryToken && tokenMatches(url.searchParams.get("access_token"));
}

function hostnameOf(authority) {
  // Host header minus its port; IPv6 literals arrive bracketed, e.g. [::1]:8787.
  const match = /^\[([^\]]+)\](?::\d+)?$/.exec(authority) || /^([^:]+)(?::\d+)?$/.exec(authority);
  return match ? match[1].toLowerCase() : "";
}

// Cross-site guard, enforced with or without a token. Any web page open in a
// browser on a tailnet device can reach this server, so:
//  - Host must be a name a DNS-rebinding attacker can't point at us: an IP,
//    localhost, a single-label (MagicDNS short) name, *.ts.net, or ALLOWED_HOSTS.
//  - A browser-sent Origin must match that Host.
//  - POSTs must be JSON, which forces a CORS preflight this server never grants.
function crossSiteRejection(req) {
  const authority = (req.headers.host || "").toLowerCase();
  const hostname = hostnameOf(authority);
  const trustedHost =
    hostname === "localhost" ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    hostname.endsWith(".ts.net") ||
    allowedHosts.has(hostname);
  if (!hostname || !trustedHost) {
    return [421, `Host "${hostname || "(missing)"}" is not allowed; add it to ALLOWED_HOSTS`];
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originAuthority = "";
    try {
      originAuthority = new URL(origin).host.toLowerCase();
    } catch {
      // "null" or malformed origins never match.
    }
    if (originAuthority !== authority) {
      return [403, "Cross-origin request rejected"];
    }
  }

  if (req.method === "POST" && !(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return [415, "POST body must be application/json"];
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function runHerdr(args, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(herdrBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`herdr ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `herdr exited with ${code}`));
      }
    });
  });
}

async function herdrJson(args) {
  const output = await runHerdr(args);
  if (!output) return null;
  return JSON.parse(output);
}

function resultOf(envelope) {
  return envelope?.result ?? envelope;
}

async function getSnapshot() {
  const [status, workspaceEnvelope, tabEnvelope, paneEnvelope, agentEnvelope] = await Promise.all([
    herdrJson(["status", "--json"]),
    herdrJson(["workspace", "list"]),
    herdrJson(["tab", "list"]),
    herdrJson(["pane", "list"]),
    herdrJson(["agent", "list"])
  ]);

  const workspaces = resultOf(workspaceEnvelope)?.workspaces ?? [];
  const tabs = resultOf(tabEnvelope)?.tabs ?? [];
  const panes = resultOf(paneEnvelope)?.panes ?? [];
  const agents = resultOf(agentEnvelope)?.agents ?? [];
  const attentionStatuses = new Set(["blocked", "done", "unknown"]);
  const attention = agents.filter((agent) => attentionStatuses.has(agent.agent_status));

  return {
    generated_at: new Date().toISOString(),
    status,
    workspaces,
    tabs,
    panes,
    agents,
    attention
  };
}

function assertId(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertText(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 12000) {
    throw new Error(`Invalid ${name}`);
  }
}

function readFormat(value) {
  return value === "ansi" ? "ansi" : "text";
}

async function readAgentTarget(target, lines, format = "text") {
  const envelope = await herdrJson([
    "agent",
    "read",
    target,
    "--source",
    "recent-unwrapped",
    "--lines",
    String(lines),
    "--format",
    readFormat(format)
  ]);
  return resultOf(envelope);
}

async function streamAgentRead(req, res, url) {
  if (!isAuthed(req, url, { allowQueryToken: true })) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const target = url.searchParams.get("target") || "";
  assertId(target, "target");
  const lines = Math.max(5, Math.min(Number(url.searchParams.get("lines") || 160), 500));
  const intervalMs = Math.max(800, Math.min(Number(url.searchParams.get("intervalMs") || 1500), 10000));
  const format = readFormat(url.searchParams.get("format"));

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(": connected\n\n");

  let lastText = "";
  let closed = false;
  let inFlight = false;

  req.on("close", () => {
    closed = true;
  });

  async function tick() {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const result = await readAgentTarget(target, lines, format);
      const text = result?.read?.text || "";
      if (text !== lastText) {
        lastText = text;
        res.write(`event: read\ndata: ${JSON.stringify(result)}\n\n`);
      }
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      inFlight = false;
    }
  }

  await tick();
  const timer = setInterval(tick, intervalMs);
  req.on("close", () => clearInterval(timer));
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  const rejection = crossSiteRejection(req);
  if (rejection) {
    return send(res, rejection[0], { error: rejection[1] });
  }

  if (req.method === "GET" && pathname === "/api/agent/stream") {
    try {
      return await streamAgentRead(req, res, url);
    } catch (error) {
      return send(res, 500, { error: error.message });
    }
  }

  if (!isAuthed(req, url)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  try {
    if (req.method === "GET" && pathname === "/api/snapshot") {
      return send(res, 200, await getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/workspace/focus") {
      const body = await readBody(req);
      assertId(body.workspace_id, "workspace_id");
      await runHerdr(["workspace", "focus", body.workspace_id]);
      return send(res, 200, await getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/workspace/create") {
      await runHerdr(["workspace", "create", "--focus"]);
      return send(res, 200, await getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/tab/focus") {
      const body = await readBody(req);
      assertId(body.tab_id, "tab_id");
      await runHerdr(["tab", "focus", body.tab_id]);
      return send(res, 200, await getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/tab/create") {
      const body = await readBody(req);
      assertId(body.workspace_id, "workspace_id");
      await runHerdr(["tab", "create", "--workspace", body.workspace_id, "--focus"]);
      return send(res, 200, await getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/agent/read") {
      const body = await readBody(req);
      assertId(body.target, "target");
      const lines = Math.max(5, Math.min(Number(body.lines || 80), 300));
      return send(res, 200, await readAgentTarget(body.target, lines, body.format));
    }

    if (req.method === "POST" && pathname === "/api/agent/explain") {
      const body = await readBody(req);
      assertId(body.target, "target");
      return send(res, 200, await herdrJson(["agent", "explain", body.target, "--json"]));
    }

    if (req.method === "POST" && pathname === "/api/pane/submit") {
      const body = await readBody(req);
      assertId(body.pane_id, "pane_id");
      assertText(body.text, "text");
      await runHerdr(["pane", "send-text", body.pane_id, body.text]);
      await runHerdr(["pane", "send-keys", body.pane_id, "Enter"]);
      return send(res, 200, await readAgentTarget(body.pane_id, 160, body.format));
    }

    if (req.method === "POST" && pathname === "/api/pane/keys") {
      const body = await readBody(req);
      assertId(body.pane_id, "pane_id");
      if (typeof body.key !== "string" || !ALLOWED_PANE_KEYS.has(body.key)) {
        return send(res, 400, { error: "Unsupported key" });
      }
      await runHerdr(["pane", "send-keys", body.pane_id, body.key]);
      return send(res, 200, await readAgentTarget(body.pane_id, 160, body.format));
    }

    if (req.method === "POST" && pathname === "/api/pane/run") {
      const body = await readBody(req);
      assertId(body.pane_id, "pane_id");
      assertText(body.command, "command");
      await runHerdr(["pane", "run", body.pane_id, body.command]);
      return send(res, 200, await readAgentTarget(body.pane_id, 160, body.format));
    }

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    return send(res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
  }

  try {
    const data = await readFile(filePath);
    const contentType = staticTypes[extname(filePath)] || "application/octet-stream";
    send(res, 200, data, { "content-type": contentType });
  } catch {
    if (req.method === "GET" && !extname(filePath)) {
      try {
        const index = await readFile(join(publicDir, "index.html"));
        return send(res, 200, index, staticTypes[".html"]);
      } catch {
        return send(res, 500, "SPA entrypoint not found", { "content-type": "text/plain; charset=utf-8" });
      }
    }
    send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url.pathname);
});

server.listen(port, host, () => {
  console.log(`herdrrmt listening on http://${host}:${port}`);
  const loopback = host === "localhost" || host === "::1" || host.startsWith("127.");
  if (!token && !loopback) {
    console.warn(
      "herdrrmt: HERDR_REMOTE_TOKEN is not set, so anyone who can reach this port can read and type into your panes. " +
        "Fine on a private tailnet you trust; set a token for defence in depth."
    );
  }
});
