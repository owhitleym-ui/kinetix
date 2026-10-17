#!/usr/bin/env node
/** Cross-platform static server for web/ (port 8801). Prefer `python`, fall back to `python3`. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const args = ["-m", "http.server", "8801", "--bind", "127.0.0.1", "--directory", web];

function run(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code));
  });
}

let code = await run("python");
if (code === null || code === 9009) code = await run("python3");
if (code === null) {
  console.error("Could not start: need python or python3 on PATH.");
  process.exit(1);
}
process.exit(code ?? 0);
