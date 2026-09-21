/**
 * `npm run plugin:install -- <dir>` — install a built plugin package from disk.
 *
 *   npm run plugin:install -- ../serene-pub-plugin-battleship
 *   npm run plugin:install -- ../my-plugin --enable
 *
 * The same `src/lib/server/plugins/install.ts` the `plugins:installLocal`
 * socket handler calls, so the terminal route and the admin route cannot drift
 * — this one exists because a plugin author's loop is `npm run package && npm
 * run plugin:install`, and neither half of that is in a browser.
 *
 * Run through `check-db-lock.js` like every `db:` command (see package.json):
 * it writes rows, and PGlite has one writer. Stop the dev server first — the
 * lock check will say so.
 *
 * Through `tsx` for the same reason as `db:recover`: the module is TypeScript
 * and resolves its neighbours the way the app does. The wrapper stays plain JS
 * so `node scripts/plugin-install.js` works with nothing built.
 */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, "plugin-install.entry.ts")
const tsconfig = resolve(here, "tsconfig.script.json")

const result = spawnSync(
	"npx",
	["tsx", "--tsconfig", tsconfig, entry, ...process.argv.slice(2)],
	{ stdio: "inherit", cwd: resolve(here, "..") }
)
process.exit(result.status ?? 1)
