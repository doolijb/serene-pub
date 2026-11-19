// node drillTerm.mjs <srcDir> <expDir> <delayMs>
// Spawns exportB.mjs on srcDir, sends SIGTERM after delayMs, waits for it to exit,
// reports exit code, signal, how long the exit took, and which files in srcDir changed.
import { spawn } from "node:child_process"
import { dirHash, diffDirHash } from "./common.mjs"
const [src, exp, delay] = process.argv.slice(2)
const before = dirHash(src)
const t0 = performance.now()
const child = spawn(process.execPath, [new URL("./exportB.mjs", import.meta.url).pathname, src, exp], { stdio: ["ignore", "pipe", "pipe"] })
let stderr = ""
child.stderr.on("data", (d) => (stderr += d))
child.stdout.on("data", () => {})
let termAt
setTimeout(() => { termAt = performance.now(); child.kill("SIGTERM") }, Number(delay))
child.on("exit", (code, signal) => {
	const after = dirHash(src)
	const d = diffDirHash(before, after)
	console.log(JSON.stringify({
		code, signal, sentAfterMs: Math.round(termAt - t0), exitTookMs: Math.round(performance.now() - termAt),
		stderr: stderr.replace(/easywasi\n?/g, "").slice(0, 300),
		srcSame: before.hash === after.hash, changed: d.changed, added: d.added, removed: d.removed
	}))
})
