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

/** Whether anything at all answers on the port right now. */
async function answering() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// REFUSED, not adopted. A server this script did not start is serving a build this script did not
// make, and driving it reports PASS/FAIL about someone else's tree — which is exactly what a
// leaked server from a previous run produces.
if (await answering()) {
  console.error(`something is already serving ${BASE}. Stop it (or set E2E_PORT) and re-run.`);
  process.exit(1);
}

// Vite's own binary, not `npx`: `npx` is a wrapper that does NOT forward SIGTERM to the process it
// spawned, so killing it left the preview server running — holding the port and serving a stale
// build to the next run. `detached` puts the server in its own process group so the whole group
// can be signalled even if vite spawns further children.
const server = spawn(
  process.execPath,
  [resolve(APP, "node_modules/vite/bin/vite.js"), "preview",
    "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: APP, stdio: ["ignore", "pipe", "inherit"], detached: true },
);
let serverOut = "";
server.stdout.on("data", (c) => { serverOut += c; });

// Killed on every exit path, including a throw and a Ctrl-C.
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM"); // the group is already gone
  }
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
