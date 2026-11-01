import { describe, expect, test } from "vitest"
import { consequenceLine, groupVoicesByLoadout } from "./voicebankRows"

const v = (id: number, name: string, loadoutId: number | null) => ({ id, name, slug: name.toLowerCase(), loadoutId })

describe("groupVoicesByLoadout", () => {
	test("loadouts-list order, names inside, empty loadouts dropped, unassigned last", () => {
		const g = groupVoicesByLoadout(
			[v(1, "Zed", 2), v(2, "amy", 2), v(3, "Bo", 1), v(4, "Lost", null), v(5, "Orphan", 99)],
			[
				{ id: 2, name: "B", defaultVoiceId: 1, otherSpeakersVoiceId: 2 },
				{ id: 1, name: "A" },
				{ id: 3, name: "Empty" }
			]
		)
		expect(g.map((x) => x.loadout?.id ?? null)).toEqual([2, 1, null])
		expect(g[0].voices.map((x) => x.name)).toEqual(["amy", "Zed"])
		expect(g[0].voiceName).toBe("Zed")
		expect(g[0].otherSpeakersName).toBe("amy")
		expect(g[1].voiceName).toBeNull()
		expect(g[2].voices.map((x) => x.name)).toEqual(["Lost", "Orphan"])
	})
})

describe("consequenceLine", () => {
	const base = { unusableReason: null, enabled: true } as any
	test("no star wording any more", () => {
		expect(consequenceLine(base)).toBe("Picked by name from cards and sessions.")
		expect(consequenceLine({ ...base, enabled: false })).toMatch(/Switched off/)
	})
})
