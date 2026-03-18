#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { resolveRuntimeBinary } from "../scripts/resolve-binary.mjs";

// 描述：
//
//   - 解析当前平台应执行的原生 runtime CLI，并把终端 stdin/stdout/stderr 透传过去。
const runtimeBinary = resolveRuntimeBinary();
const child = spawn(runtimeBinary, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  process.stderr.write(`failed to start runtime binary: ${error.message}\n`);
  process.exit(1);
});
