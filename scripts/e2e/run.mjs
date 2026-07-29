/**
 * Serves the app's production build and drives it, then tears the server down again. `drive.mjs`
 * takes a URL and starts nothing, so `npm run e2e` used to build and then fail on
 * `ERR_CONNECTION_REFUSED` unless someone happened to have a preview server already running — a
 * check that cannot run as documented is a claim, not a guarantee.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../../app");
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(
  "npx",
  ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: APP, stdio: ["ignore", "pipe", "inherit"] },
);
let serverOut = "";
server.stdout.on("data", (c) => { serverOut += c; });

// Killed on every exit path, including a throw and a Ctrl-C: a preview server outliving the run
// holds the port, and the next run fails on `--strictPort` rather than on anything real.
let stopped = false;
const stop = () => {
  if (!stopped) { stopped = true; server.kill("SIGTERM"); }
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop(); process.exit(130); });

async function reachable(deadline) {
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false;
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

if (!(await reachable(Date.now() + 60_000))) {
  stop();
  console.error(`preview server never answered on ${BASE}\n${serverOut}`);
  process.exit(1);
}

const drive = spawn(process.execPath, [resolve(HERE, "drive.mjs")], {
  stdio: "inherit",
  env: { ...process.env, BASE },
});
const code = await new Promise((r) => drive.on("exit", (c, signal) => r(signal ? 1 : (c ?? 1))));
stop();
process.exit(code);
