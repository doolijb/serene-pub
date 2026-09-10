import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guards the shipped migration journal's `when` chain.
 *
 * ## Why this needs a test rather than a code review
 *
 * Drizzle decides what to apply by comparing each journal entry's `when`
 * against the `created_at` of the newest row already in `__drizzle_migrations`.
 * Anything at or below that mark looks like it is already in the past and is
 * skipped — silently, with no error and no log line. So a single `when` that is
 * out of order does not break a migration, it *deletes* it, and only on the
 * databases that already got that far.
 *
 * That is invisible to every integration suite in this repo, because they all
 * build a fresh database: with no applied rows there is nothing to compare
 * against, the ordering check short-circuits, and all 102 files apply in
 * sequence no matter what their timestamps say. The bug lives exclusively on
 * real installs. This file is the only place it can be caught.
 *
 * ## The failure this was written for
 *
 * `0100_narration_split_reprojection` and `0101_connection_notes` were stamped
 * `1788910000000` and `1788910100000` — round numbers picked to look like
 * timestamps, roughly 22 hours ahead of the real clock. `drizzle-kit generate`
 * stamps `Date.now()`, so the *next* generated migration came out below the
 * journal's maximum and would have been inert on every database that had
 * applied 0100 or 0101. `0101` itself was generated at `1788830057137` and was
 * raised over 0100 by hand for exactly that reason. Both were rewritten to the
 * times they were actually generated.
 *
 * A future `when` is therefore not a cosmetic wart: it plants a floor that
 * every honestly-stamped migration after it falls under, and it keeps doing so
 * until wall time catches up.
 *
 * ## Relationship to the boot-time guard
 *
 * `dataUpgrades/tagsInJournalOrder` already throws on a non-increasing chain,
 * and it runs against the real folder on every boot (`db/index.ts`). But it
 * reports the problem to a user whose app has already failed to start, and it
 * says nothing at all about a stamp in the future — which is the shape the
 * defect actually took. This moves both checks to CI, where they are cheap.
 */

interface JournalEntry {
	idx: number
	version: string
	when: number
	tag: string
	breakpoints: boolean
}

const JOURNAL_PATH = resolve("drizzle/meta/_journal.json")

const entries: JournalEntry[] = JSON.parse(
	readFileSync(JOURNAL_PATH, "utf8")
).entries

describe("drizzle migration journal", () => {
	it("has entries to check", () => {
		// The guard on the guard: a parse that yielded nothing would make every
		// assertion below pass vacuously.
		expect(entries.length).toBeGreaterThan(0)
	})

	it("stamps every entry after every entry before it", () => {
		// Journal order is application order, so the property is pairwise —
		// but stated as "exceeds everything preceding it" rather than "exceeds
		// its immediate predecessor", because that is what drizzle compares
		// against: the newest applied row, not the last one in the file.
		const offenders = entries.flatMap((entry, i) => {
			if (i === 0) return []
			const preceding = entries.slice(0, i)
			const highest = preceding.reduce((a, b) => (b.when > a.when ? b : a))
			return entry.when > highest.when
				? []
				: [
						`"${entry.tag}" (when=${entry.when}) does not exceed ` +
							`"${highest.tag}" (when=${highest.when}), so it would never apply ` +
							`to a database that already has "${highest.tag}"`
					]
		})

		expect(offenders).toEqual([])
	})

	it("stamps no entry in the future", () => {
		// ⚠ Deliberately a ceiling, never a floor. `when <= now` compares a
		// literal frozen in a committed file against a clock that only moves
		// forward: once it holds it holds forever, so this cannot rot into a
		// failure a year from now the way "the newest entry is recent" or "the
		// newest entry is above <hardcoded constant>" would. What it catches is
		// a *newly written* stamp above the clock — a hand-picked round number,
		// or a machine whose clock ran ahead — at the moment it is added, which
		// is the only moment anyone can still fix it cheaply.
		//
		// No skew tolerance on purpose: a journal reaches CI committed, hours
		// or days after it was generated, so any entry still ahead of the clock
		// is ahead by design rather than by drift.
		const now = Date.now()
		const future = entries
			.filter((entry) => entry.when > now)
			.map(
				(entry) =>
					`"${entry.tag}" (when=${entry.when}) is ${entry.when - now}ms ahead of ` +
					`the clock, so every migration generated before it catches up would be skipped`
			)

		expect(future).toEqual([])
	})
})
