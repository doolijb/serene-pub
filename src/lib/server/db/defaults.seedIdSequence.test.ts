import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guards the fresh-install seeding path.
 *
 * Postgres does not advance a table's id sequence when a row is inserted with
 * an explicit id. So a seed list that mixes rows carrying a legacy `id:` with
 * rows that let the sequence assign one will, on an empty database, hand the
 * sequence-assigned row an id that the explicit rows already took — a primary
 * key violation.
 *
 * That is not theoretical: defaultSamplingConfigs (ids 1 and 2 explicit, a
 * third relying on the sequence) crashed syncDatabaseDefaults() on every brand
 * new install. Because the whole function aborted, context configs were never
 * seeded, the system_settings insert then failed its foreign key, and the app
 * rendered a permanently blank page with only "System settings not found" in
 * the server log.
 *
 * A mixed list is fine *provided* the sequence is bumped past the explicit ids
 * before the inserts run — see the setval() guard in defaults.ts. This test
 * fails on any mixed list that has no such guard, so the next one added is
 * caught here instead of on a user's first boot.
 */

const SETVAL_GUARD = /pg_get_serial_sequence\(\s*'(\w+)'/g

interface SeedList {
	name: string
	entries: number
	explicitIds: number[]
}

function parseSeedLists(source: string): SeedList[] {
	const out: SeedList[] = []
	const declaration = /const (default\w+)\s*:\s*[^=]*=\s*\[/g
	let m: RegExpExecArray | null
	while ((m = declaration.exec(source))) {
		const open = source.indexOf("[", m.index)
		let depth = 0
		let end = open
		for (let i = open; i < source.length; i++) {
			if (source[i] === "[") depth++
			else if (source[i] === "]") {
				depth--
				if (depth === 0) {
					end = i
					break
				}
			}
		}
		const block = source.slice(open, end)
		const entries = [...block.matchAll(/seedKey:\s*"([^"]+)"/g)].length
		const explicitIds = [...block.matchAll(/^\s*id:\s*(\d+),/gm)].map((x) =>
			Number(x[1])
		)
		if (entries > 0) out.push({ name: m[1], entries, explicitIds })
	}
	return out
}

describe("database default seeding", () => {
	const source = readFileSync(resolve(__dirname, "defaults.ts"), "utf8")

	it("never mixes explicit and sequence-assigned ids without a setval guard", () => {
		const guardedTables = new Set(
			[...source.matchAll(SETVAL_GUARD)].map((m) => m[1])
		)

		const unguarded = parseSeedLists(source).filter((list) => {
			const mixed =
				list.explicitIds.length > 0 &&
				list.explicitIds.length < list.entries
			if (!mixed) return false
			// crude but sufficient: sampling_configs <- defaultSamplingConfigs
			const table = list.name
				.replace(/^default/, "")
				.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
				.toLowerCase()
			return !guardedTables.has(table)
		})

		expect(
			unguarded.map((l) => l.name),
			"seed list mixes explicit `id:` values with sequence-assigned rows and has no setval() bump before its inserts — on a fresh database this throws a duplicate-key error and aborts all seeding"
		).toEqual([])
	})

	it("still declares the sampling_configs sequence guard", () => {
		// The specific regression: remove this and fresh installs break again.
		expect(source).toMatch(/pg_get_serial_sequence\(\s*'sampling_configs'/)
		expect(source).toMatch(/GREATEST\(/)
	})
})
