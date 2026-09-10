/**
 * `npm run db:recover` — restore a backup, or start fresh, from a terminal.
 *
 *   npm run db:recover -- --list
 *   npm run db:recover -- --backup [label]
 *   npm run db:recover -- --restore <file>
 *   npm run db:recover -- --fresh
 *
 * The same `src/lib/server/db/recovery.ts` the recovery page uses, so the two
 * cannot drift apart — this is the headless route for Docker, a NAS, or any
 * install the page's local-network rule cannot reach from a browser.
 *
 * Run through `check-db-lock.js` like every other `db:` command (see
 * package.json): moving a data directory while the app has it open is the one
 * way to make a recoverable situation worse.
 *
 * Through `tsx` for the same reason as `pipeline:ab`: the module is TypeScript
 * and resolves its neighbours the way the app does. The wrapper stays plain JS
 * so `node scripts/db-recover.js` works with nothing built.
 */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, "db-recover.entry.ts")
const tsconfig = resolve(here, "tsconfig.script.json")

const result = spawnSync(
	"npx",
	["tsx", "--tsconfig", tsconfig, entry, ...process.argv.slice(2)],
	{ stdio: "inherit", cwd: resolve(here, "..") }
)
process.exit(result.status ?? 1)
