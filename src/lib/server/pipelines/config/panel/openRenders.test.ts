/**
 * Typed templates P2: the panel opens a `variables` slot's `renders` from ROWS.
 *
 * `openRenders` walks the stored document back from the slot's in-port and
 * reads each node's in-ports and declared bands off its registry row — `ports`
 * and `policy.bands` — never off a loaded plugin (F6). What comes back is the
 * static `renders` plus every band declared upstream, flagged as bands, so
 * `world.ts` resolves them and Assemble renders them at the top level.
 */
import { describe, it, expect } from "vitest"
import { assemble } from "@serene-pub/contracts"
import type { SlotDecl, SpecDocument } from "@serene-pub/sdk"
import { openRenders } from "$lib/server/pipelines/config/panel/declarations"

const CANDIDATES = "core:shape/context-candidates@1"

const node = (key: string, definitionId: string) => ({
	key,
	kind: "task",
	definitionId,
	definitionVersion: 1,
	config: {},
	position: 0
})

/** The Twenty Questions speak path, as stored: two sources, concat, rank, assemble. */
const doc = {
	nodes: [
		node("lore", "core:query/lorebook-triggers"),
		node("secret", "showcase.twenty-questions:task/pick-secret-entry"),
		node("tally", "showcase.twenty-questions:task/tally-question"),
		node("pool", "core:task/concat-candidates"),
		node("rank", "core:task/rank-hybrid"),
		node("speakPrompt", "core:task/assemble")
	],
	edges: [
		{ from: "lore", fromPort: "hits", to: "pool", toPort: "sources.0" },
		{ from: "secret", fromPort: "candidates", to: "pool", toPort: "sources.1" },
		{ from: "tally", fromPort: "candidates", to: "pool", toPort: "sources.2" },
		{ from: "pool", fromPort: "candidates", to: "rank", toPort: "candidates" },
		{ from: "rank", fromPort: "candidates", to: "speakPrompt", toPort: "candidates" }
	]
} as unknown as SpecDocument

/** Registry rows, as the table holds them: ports by shape id, bands on policy. */
const rows = new Map<string, any>([
	[
		"core:query/lorebook-triggers@1",
		{
			ports: { in: { scope: "core:shape/session-scope@1" } },
			policy: {
				bands: {
					characterLore: "core:var/character-lore@1",
					history: "core:var/history@1",
					worldLore: "core:var/world-lore@1"
				}
			}
		}
	],
	[
		"showcase.twenty-questions:task/pick-secret-entry@1",
		{
			ports: { in: { entries: CANDIDATES } },
			policy: { bands: { secretEntry: "showcase.twenty-questions:var/secret-entry@1" } }
		}
	],
	[
		"showcase.twenty-questions:task/tally-question@1",
		{
			ports: { in: {} },
			policy: { bands: { briefing: "showcase.twenty-questions:var/briefing@1" } }
		}
	],
	["core:task/concat-candidates@1", { ports: { in: { sources: CANDIDATES } }, policy: {} }],
	["core:task/rank-hybrid@1", { ports: { in: { candidates: CANDIDATES } }, policy: {} }],
	["core:task/assemble@2", { ports: { in: { candidates: CANDIDATES } }, policy: {} }]
])

describe("openRenders (typed templates P2)", () => {
	const slot = assemble.descriptor.slots!.variables as SlotDecl

	it("opens Assemble's renders to every band declared upstream, from rows", async () => {
		const opened = await openRenders(async () => doc, "speakPrompt", slot, rows)
		expect(opened.renders).toEqual({
			worldLore: "core:var/world-lore@1",
			history: "core:var/history@1",
			currentDate: "core:var/current-date@1",
			secretEntry: "showcase.twenty-questions:var/secret-entry@1",
			briefing: "showcase.twenty-questions:var/briefing@1"
		})
		// Only the declared bands are flagged — the node's own keys are not,
		// and `characterLore` is `raw` so it is not a setting at all.
		expect(opened.bandKeys.sort()).toEqual(["briefing", "secretEntry"])
	})

	it("refuses two declarers naming one band differently, naming both", async () => {
		const rival = new Map(rows)
		rival.set("showcase.twenty-questions:task/tally-question@1", {
			ports: { in: {} },
			policy: { bands: { secretEntry: "other:var/secret@1" } }
		})
		await expect(
			openRenders(async () => doc, "speakPrompt", slot, rival)
		).rejects.toThrow(
			/band 'secretEntry'.*'secret' \(showcase\.twenty-questions:task\/pick-secret-entry@1\).*'tally' \(showcase\.twenty-questions:task\/tally-question@1\)/s
		)
	})
})
