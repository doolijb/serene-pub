/**
 * Compare both prompt paths on your own chats.
 *
 *   npm run pipeline:compare -- 12 13 14     # specific chats
 *   npm run pipeline:compare                 # every chat with messages
 *
 * Sends nothing and writes nothing: the pipeline side runs as a preview, which
 * stops at the pre-call substrate with the real payload, and the legacy side
 * compiles a prompt and drops it.
 *
 * The app holds a lock on the database, so **stop the server first**. That is a
 * property of PGlite rather than of this script, and `check-db-lock.js` is what
 * every other db command here goes through for the same reason.
 */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, "compare-prompts.entry.ts")
const tsconfig = resolve(here, "tsconfig.script.json")

// Through `tsx` so the `$lib` aliases and TypeScript resolve exactly as they do
// in the app — a comparison run against differently-resolved modules would be
// comparing something other than what ships.
const result = spawnSync(
	"npx",
	["tsx", "--tsconfig", tsconfig, entry, ...process.argv.slice(2)],
	{ stdio: "inherit", cwd: resolve(here, "..") }
)
process.exit(result.status ?? 1)
