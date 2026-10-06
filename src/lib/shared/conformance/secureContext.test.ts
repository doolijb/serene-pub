/**
 * Browser code never calls `crypto.randomUUID()`.
 *
 * It exists only in a secure context (HTTPS, or localhost). Serene Pub is often
 * reached over a plain `http://<lan-ip>` address — a phone on the same Wi-Fi, a
 * NAS or Docker host — and there `crypto.randomUUID` is undefined. One call in
 * the widget host (`ComponentMount.svelte`) made every session render blank for
 * people on such an address (reported against 0.6, 2026-10-05).
 *
 * Use `import { v4 as uuid } from "uuid"`, which falls back to
 * `crypto.getRandomValues` where `randomUUID` is missing.
 *
 * Scope: everything that can reach the browser — `src/lib/client`,
 * `src/lib/shared` and `src/routes`. Server code (`src/lib/server`) runs in Node,
 * where `randomUUID` is always present. Comments are ignored.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = resolve(__dirname, "../../../..")
const BROWSER_REACHABLE = ["src/lib/client", "src/lib/shared", "src/routes"]
const SOURCE = /\.(ts|js|svelte)$/
const CALL = /\bcrypto\s*\.\s*randomUUID\b/

function* sourceFiles(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) yield* sourceFiles(path)
		else if (SOURCE.test(name) && !/\.test\./.test(name)) yield path
	}
}

/** Drops block and line comments; a false negative costs less than a false alarm here. */
function code(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
		.replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("secure-context APIs in browser code", () => {
	test("no browser-reachable file calls crypto.randomUUID()", () => {
		const offenders: string[] = []
		for (const dir of BROWSER_REACHABLE) {
			for (const file of sourceFiles(join(ROOT, dir))) {
				const lines = code(readFileSync(file, "utf8")).split("\n")
				lines.forEach((line, i) => {
					if (CALL.test(line))
						offenders.push(`${relative(ROOT, file)}:${i + 1}`)
				})
			}
		}
		expect(
			offenders,
			'crypto.randomUUID is undefined on plain-http LAN addresses; use `import { v4 as uuid } from "uuid"`'
		).toEqual([])
	})
})
