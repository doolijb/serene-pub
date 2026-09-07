/**
 * A/B one configuration against another, on your own sessions.
 *
 *   npm run pipeline:ab -- --list                 # what can be turned on
 *   npm run pipeline:ab -- admission              # every session with messages
 *   npm run pipeline:ab -- admission 12 13        # just these
 *   npm run pipeline:ab -- semantic 12 --full     # both prompts, not a patch
 *   npm run pipeline:ab -- admission --summary    # no prompt text at all
 *   npm run pipeline:ab -- --set gather.worldLore.read:admitThreshold=0.3 12
 *
 * Retrieval plan phase 6. It sends nothing, writes nothing, and reads a
 * **copy** of your database rather than the database — so it is safe to run
 * with the app open, and unlike every other db command here it does not go
 * through `check-db-lock.js`, because it never touches the file that lock is
 * about. See `prompt-ab.entry.ts` for exactly what is copied.
 *
 * Through `tsx` so the `$lib` aliases and TypeScript resolve exactly as they do
 * in the app: a comparison run against differently-resolved modules would be
 * comparing something other than what ships.
 */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, "prompt-ab.entry.ts")
const tsconfig = resolve(here, "tsconfig.script.json")

const result = spawnSync(
	"npx",
	["tsx", "--tsconfig", tsconfig, entry, ...process.argv.slice(2)],
	{ stdio: "inherit", cwd: resolve(here, "..") }
)
process.exit(result.status ?? 1)
