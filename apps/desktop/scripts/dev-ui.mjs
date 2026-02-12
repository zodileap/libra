import { execSync, spawn } from "node:child_process";

const PORT = 1420;
const HOST = "127.0.0.1";
const CHECK_ONLY = process.argv.includes("--check-only");
const FORCE_RESTART = process.env.FORCE_RESTART_UI === "1";
const HEALTH_URLS = [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`];

function listPidsOnPort(port) {
  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /LISTENING/i.test(line));
      const pids = lines
        .map((line) => line.split(/\s+/).pop())
        .filter((value) => value && /^\d+$/.test(value))
        .map((value) => Number(value));
      return [...new Set(pids)];
    } catch (_err) {
      return [];
    }
  }

  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((value) => /^\d+$/.test(value))
      .map((value) => Number(value));
  } catch (_err) {
    return [];
  }
}

function killPid(pid) {
  if (!pid || Number.isNaN(pid)) return;
  if (pid === process.pid) return;

  if (process.platform === "win32") {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } catch (_err) {
      // ignore
    }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (_err) {
    // ignore
  }
}

async function isDevServerReachable() {
  for (const url of HEALTH_URLS) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok || response.status === 304) {
        return true;
      }
    } catch (_err) {
      // try next url
    }
  }
  return false;
}

async function ensurePortAvailable(port) {
  const pids = listPidsOnPort(port);
  if (pids.length === 0) {
    return { reused: false };
  }

  const reachable = await isDevServerReachable();
  if (!FORCE_RESTART) {
    if (reachable) {
      console.log(
        `[dev:ui] port ${port} is in use by pid(s): ${pids.join(", ")}, existing dev server is healthy, reusing.`
      );
      return { reused: true };
    }
    console.log(
      `[dev:ui] port ${port} is occupied by pid(s): ${pids.join(", ")}, but server is unhealthy. Trying restart...`
    );
  }

  console.log(
    `[dev:ui] killing pid(s) on ${port}: ${pids.join(", ")}${FORCE_RESTART ? " (forced)" : ""}`
  );
  for (const pid of pids) killPid(pid);

  // Give OS time to release socket.
  const waitUntil = Date.now() + 1200;
  while (Date.now() < waitUntil) {
    const remainingNow = listPidsOnPort(port);
    if (remainingNow.length === 0) break;
  }
  const remaining = listPidsOnPort(port);
  if (remaining.length > 0) {
    const reusedReachable = await isDevServerReachable();
    if (reusedReachable) {
      console.log(
        `[dev:ui] after restart attempt, port ${port} still occupied but service is reachable, reusing existing server.`
      );
      return { reused: true };
    }
    if (CHECK_ONLY) {
      console.log(
        `[dev:ui] check-only: ${HOST}:${port} is still in use by ${remaining.join(", ")} and unreachable.`
      );
      return { reused: true };
    }
    throw new Error(
      `port ${port} still in use by pid(s): ${remaining.join(", ")} and server unreachable; please terminate these processes manually`
    );
  }
  return { reused: false };
}

async function main() {
  const portState = await ensurePortAvailable(PORT);
  if (CHECK_ONLY) {
    console.log(
      `[dev:ui] check-only ok: ${HOST}:${PORT} ${portState.reused ? "is reused" : "is available"}.`
    );
    process.exit(0);
  }

  if (portState.reused) {
    process.exit(0);
  }

  const child = spawn(
    "pnpm",
    ["exec", "vite", "--host", HOST, "--port", String(PORT), "--strictPort", "--logLevel", "error"],
    {
      stdio: "inherit",
      env: process.env,
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[dev:ui] ${message}`);
  process.exit(1);
});
