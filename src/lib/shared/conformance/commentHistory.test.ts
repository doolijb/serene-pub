/**
 * A comment states the rule, not the story.
 *
 * "Used to", "previously", "no longer", a migration number cited as history,
 * a measurement, an anecdote about why a file exists — none of it is the
 * invariant a future reader needs, and all of it rots the moment the history
 * stops being true. Rationale that needs a paragraph belongs in `docs/`, with
 * a one-line pointer left behind; everything else is either a present-tense
 * rule or nothing.
 *
 * This is a RATCHET, not an allowlist: `commentHistory.ratchet.json` records
 * a phrase-hit count per file, and a file may only ever match its recorded
 * count or fewer. There is no excuse mechanism, because there is no
 * legitimate reason for the count to go up — every phrase below is written
 * in a way that only the narrative sense fires. A file that regresses fails
 * here with the offending lines printed; a file that improves does not fail,
 * it prints a note that `npm run comments:ratchet` can lower its entry.
 */

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { computeReport } from "./commentHistoryLib.js"

const ROOT = resolve(__dirname, "../../../..")
const RATCHET_PATH = join(__dirname, "commentHistory.ratchet.json")

interface Ratchet {
	readonly total: number
	readonly byFile: Readonly<Record<string, number>>
}

/** Missing entirely reads as an empty ratchet — everything is a regression. */
function readRatchet(): Ratchet {
	if (!existsSync(RATCHET_PATH)) return { total: 0, byFile: {} }
	return JSON.parse(readFileSync(RATCHET_PATH, "utf8")) as Ratchet
}

describe("comment history ratchet — comments state the rule, not the story", () => {
	test("no file's phrase-hit count exceeds its recorded ratchet", () => {
		const ratchet = readRatchet()
		const current = computeReport(ROOT)

		const overBudget: string[] = []
		for (const [file, count] of Object.entries(current.byFile)) {
			const recorded = ratchet.byFile[file] ?? 0
			if (count <= recorded) continue
			const offenders = current.offendersByFile[file]
			overBudget.push(
				`${file}: ${count} (ratchet allows ${recorded})\n` +
					offenders
						.map((o) => `    ${o.line}: [${o.phrase}] ${o.text}`)
						.join("\n")
			)
		}

		const lowered: string[] = []
		for (const [file, recorded] of Object.entries(ratchet.byFile)) {
			const count = current.byFile[file] ?? 0
			if (count < recorded) lowered.push(`${file}: ${recorded} → ${count}`)
		}
		if (lowered.length)
			console.log(
				`${lowered.length} file(s) have fewer phrase-list hits than the ` +
					`ratchet records. Run \`npm run comments:ratchet\` to lower it:\n` +
					lowered.map((l) => `  • ${l}`).join("\n")
			)

		expect(
			overBudget,
			overBudget.length
				? `${overBudget.length} file(s) exceed their comment-history ` +
						`ratchet:\n\n${overBudget.join("\n\n")}\n\nRewrite each flagged ` +
						`comment as the present-tense rule, move rationale that needs a ` +
						`paragraph to docs/ with a one-line pointer, or delete it if it is ` +
						`pure history. Then run \`npm run comments:ratchet\` to record the ` +
						`lower count. Do not weaken the phrase list to pass this.`
				: undefined
		).toEqual([])
	})
})
