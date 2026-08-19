/**
 * The comparison itself. Run through `scripts/compare-prompts.js`.
 *
 * Two stages, and the split is load-bearing. Vite replaces `__APP_VERSION__` at
 * build time and `db/index.ts` reads it at module scope, so the constant has to
 * exist *before* anything under `src/lib/server` is imported — and a static
 * import would be hoisted above the assignment. Hence: define, then dynamically
 * import the work.
 *
 * Importing `$lib/server/db` opens PGlite, migrates and seeds — the same path
 * the app takes — so this reads exactly the database the app would.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
	readFileSync(resolve(here, "..", "package.json"), "utf8")
)
;(globalThis as any).__APP_VERSION__ = pkg.version

const { db } = await import("$lib/server/db")
const schema = await import("$lib/server/db/schema")
const { comparePrompts } = await import("$lib/server/pipelines/compare")
const { renderParity } = await import("@serene-pub/sdk")
const { sql } = await import("drizzle-orm")

async function main() {
	const requested = process.argv.slice(2).map(Number).filter(Boolean)

	const chatIds = requested.length
		? requested
		: (
				await db
					.select({ id: schema.chats.id })
					.from(schema.chats)
					.where(
						sql`exists (select 1 from chat_messages m where m.chat_id = ${schema.chats.id})`
					)
			).map((r) => r.id)

	if (chatIds.length === 0) {
		console.log("No chats with messages — nothing to compare.")
		return 0
	}

	console.log(`Comparing ${chatIds.length} chat(s)…\n`)

	let identical = 0
	let diverged = 0
	let stopped = 0

	for (const chatId of chatIds) {
		try {
			const r = await comparePrompts({ db, chatId })
			if (r.stopped) {
				stopped++
				console.log(
					`◦ chat/${chatId}  did not reach the provider: ${r.stopped}`
				)
				continue
			}
			if (r.identical) identical++
			else diverged++
			console.log(renderParity(r))

			// The excerpt around the first difference is the right default —
			// two multi-kilobyte prompts side by side are unreadable — but when
			// the difference is structural rather than local, seeing both whole
			// is what actually finds it.
			if (process.env.PROMPT_DIFF && !r.identical) {
				const { comparePromptTexts } = await import(
					"$lib/server/pipelines/compare"
				)
				const both = await comparePromptTexts({ db, chatId })
				console.log(
					`\n───── legacy (chat/${chatId}) ─────\n${both.legacy}` +
						`\n───── pipeline (chat/${chatId}) ─────\n${both.pipeline}\n`
				)
			}
		} catch (err) {
			stopped++
			console.log(`◦ chat/${chatId}  ${(err as Error).message}`)
		}
	}

	console.log(
		`\n${identical} identical, ${diverged} diverged, ${stopped} could not run.`
	)
	// A divergence is a finding, so it is worth a non-zero exit — this is
	// runnable in CI as-is.
	return diverged > 0 ? 1 : 0
}

// Exited explicitly, from one place. PGlite keeps a handle open, so a script
// that merely finishes its work sits there until something kills it — which
// looks exactly like a hang on a large chat, and is the first thing anyone
// would blame the comparison for.
main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
