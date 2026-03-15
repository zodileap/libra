import { execSync, spawn } from "node:child_process";

export const DEV_UI_PORT = 1420;
export const DEV_UI_HOST = "127.0.0.1";

const CHECK_ONLY = process.argv.includes("--check-only");
const FORCE_RESTART = process.env.FORCE_RESTART_UI === "1";
const HEALTH_URLS = [`http://${DEV_UI_HOST}:${DEV_UI_PORT}`, `http://localhost:${DEV_UI_PORT}`];

// 描述：
//
//   - 读取 Windows 指定 TCP 端口上的监听进程，用于在本地开发时复用或清理已占用的 Vite 端口。
//
// Params:
//
//   - port: 需要检测的 TCP 端口。
//
// Returns:
//
//   - 监听该端口的进程 ID 列表；未检测到时返回空数组。
export function listWindowsPidsOnPort(port) {
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

// 描述：
//
//   - 读取类 Unix 系统指定 TCP 端口上的监听进程，用于在本地开发时复用或清理已占用的 Vite 端口。
//
// Params:
//
//   - port: 需要检测的 TCP 端口。
//
// Returns:
//
//   - 监听该端口的进程 ID 列表；未检测到时返回空数组。
export function listUnixPidsOnPort(port) {
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

// 描述：
//
//   - 在 Windows 上强制结束指定进程，避免被旧的开发服务器持续占用端口。
//
// Params:
//
//   - pid: 待结束的进程 ID。
export function killWindowsPid(pid) {
  if (!pid || Number.isNaN(pid) || pid === process.pid) {
    return;
  }

  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
  } catch (_err) {
    // ignore
  }
}

// 描述：
//
//   - 在类 Unix 系统上结束指定进程，避免被旧的开发服务器持续占用端口。
//
// Params:
//
//   - pid: 待结束的进程 ID。
export function killUnixPid(pid) {
  if (!pid || Number.isNaN(pid) || pid === process.pid) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (_err) {
    // ignore
  }
}

// 描述：
//
//   - 检查当前开发地址是否已有可复用的 Vite 服务，避免重复启动第二个前端进程。
//
// Returns:
//
//   - true: 服务可访问，可直接复用。
//   - false: 服务不可访问，需要重新启动。
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

// 描述：
//
//   - 统一处理端口占用检测、旧进程清理与可复用服务判断，确保系统差异只保留在运行时适配层。
//
// Params:
//
//   - systemRuntime: 当前系统的脚本运行配置。
//   - port: 需要准备的端口。
//
// Returns:
//
//   - reused: 是否复用了现有服务。
async function ensurePortAvailable(systemRuntime, port) {
  const pids = systemRuntime.listPidsOnPort(port);
  if (pids.length === 0) {
    return { reused: false };
  }

  const reachable = await isDevServerReachable();
  if (!FORCE_RESTART) {
    if (reachable) {
      console.log(
        `[dev:ui:${systemRuntime.systemName}] port ${port} is in use by pid(s): ${pids.join(", ")}, existing dev server is healthy, reusing.`
      );
      return { reused: true };
    }
    console.log(
      `[dev:ui:${systemRuntime.systemName}] port ${port} is occupied by pid(s): ${pids.join(", ")}, but server is unhealthy. Trying restart...`
    );
  }

  console.log(
    `[dev:ui:${systemRuntime.systemName}] killing pid(s) on ${port}: ${pids.join(", ")}${FORCE_RESTART ? " (forced)" : ""}`
  );
  for (const pid of pids) {
    systemRuntime.killPid(pid);
  }

  const waitUntil = Date.now() + 1200;
  while (Date.now() < waitUntil) {
    if (systemRuntime.listPidsOnPort(port).length === 0) {
      break;
    }
  }

  const remaining = systemRuntime.listPidsOnPort(port);
  if (remaining.length > 0) {
    const reusedReachable = await isDevServerReachable();
    if (reusedReachable) {
      console.log(
        `[dev:ui:${systemRuntime.systemName}] after restart attempt, port ${port} still occupied but service is reachable, reusing existing server.`
      );
      return { reused: true };
    }
    if (CHECK_ONLY) {
      console.log(
        `[dev:ui:${systemRuntime.systemName}] check-only: ${DEV_UI_HOST}:${port} is still in use by ${remaining.join(", ")} and unreachable.`
      );
      return { reused: true };
    }
    throw new Error(
      `port ${port} still in use by pid(s): ${remaining.join(", ")} and server unreachable; please terminate these processes manually`
    );
  }

  return { reused: false };
}

// 描述：
//
//   - 根据传入的系统运行配置启动 Desktop 前端开发服务，并统一复用端口检查与进程退出处理。
//
// Params:
//
//   - systemRuntime: 当前系统的脚本运行配置。
export async function runDevUi(systemRuntime) {
  const portState = await ensurePortAvailable(systemRuntime, DEV_UI_PORT);
  if (CHECK_ONLY) {
    console.log(
      `[dev:ui:${systemRuntime.systemName}] check-only ok: ${DEV_UI_HOST}:${DEV_UI_PORT} ${portState.reused ? "is reused" : "is available"}.`
    );
    process.exit(0);
  }

  if (portState.reused) {
    process.exit(0);
  }

  const child = spawn(
    systemRuntime.pnpmCommand,
    ["exec", "vite", "--host", DEV_UI_HOST, "--port", String(DEV_UI_PORT), "--strictPort", "--logLevel", "error"],
    {
      stdio: "inherit",
      env: process.env,
      shell: systemRuntime.useShell,
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
