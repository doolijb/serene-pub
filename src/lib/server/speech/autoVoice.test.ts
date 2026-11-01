import { describe, expect, it } from "vitest"
import { pickAutoVoice, type AutoVoiceInput } from "./autoVoice"

const c = (slug: string, labels: Record<string, string> = {}) => ({ slug, labels })
const base: AutoVoiceInput = {
	candidates: [c("bruno"), c("mira"), c("sol")],
	narratorSlug: "bruno",
	usedSlugs: [],
	stored: null,
	casting: null,
	speakerRef: "character:7",
	sessionId: 3
}
const run = (over: Partial<AutoVoiceInput> = {}) => pickAutoVoice({ ...base, ...over })

describe("pickAutoVoice", () => {
	it("is deterministic: the same input picks the same slug, twice", () => {
		const a = run()
		const b = run({ candidates: [...base.candidates].reverse() })
		expect(a.slug).toBe(b.slug)
		expect(run()).toEqual(a)
		expect(a).toMatchObject({ reason: "avoids-narrator", fresh: true })
	})
	it("never picks the narrator's entry", () => {
		for (let i = 0; i < 40; i++) expect(run({ speakerRef: `character:${i}` }).slug).not.toBe("bruno")
	})
	it("different speakers spread over the pool", () => {
		const seen = new Set<string | null>()
		for (let i = 0; i < 60; i++) seen.add(run({ speakerRef: `character:${i}` }).slug)
		expect(seen).toEqual(new Set(["mira", "sol"]))
	})
	it("excludes slugs already used", () => {
		for (let i = 0; i < 20; i++)
			expect(run({ speakerRef: `character:${i}`, usedSlugs: ["mira"] }).slug).toBe("sol")
	})
	it("falls back to the whole pool, shared, when every other voice is used", () => {
		const r = run({ usedSlugs: ["mira", "sol"] })
		expect(["mira", "sol"]).toContain(r.slug)
		expect(r).toMatchObject({ reason: "shared", fresh: true })
	})
	it("only the narrator's voice: no pick", () => {
		expect(run({ candidates: [c("bruno")] })).toMatchObject({ slug: null, reason: "only-narrator", fresh: false })
		expect(run({ candidates: [] })).toMatchObject({ slug: null, reason: "only-narrator" })
	})
	it("reuses a stored pick that is still a candidate (sticky, not fresh)", () => {
		expect(run({ stored: "sol", usedSlugs: ["sol"] })).toEqual({ slug: "sol", reason: "sticky", fresh: false, staleStored: false })
	})
	it("drops a stale stored pick: gone, or now the narrator's", () => {
		expect(run({ stored: "ghost" })).toMatchObject({ fresh: true, staleStored: true })
		expect(run({ stored: "ghost" }).slug).not.toBe("ghost")
		expect(run({ stored: "bruno" })).toMatchObject({ staleStored: true })
		expect(run({ stored: "bruno" }).slug).not.toBe("bruno")
		expect(run({ stored: "ghost", candidates: [c("bruno")] })).toMatchObject({ slug: null, staleStored: true })
	})
	it("casting prefers matching labels (gender/age, case-insensitive)", () => {
		const candidates = [c("bruno"), c("mira", { gender: "Female", age: "young" }), c("sol", { gender: "male" }), c("nyx", { gender: "female", age: "old" })]
		for (let i = 0; i < 20; i++) {
			const r = run({ candidates, speakerRef: `e:${i}`, casting: { gender: "FEMALE", age: "old" } })
			expect(r.slug).toBe("nyx")
		}
		for (let i = 0; i < 20; i++)
			expect(["mira", "nyx"]).toContain(run({ candidates, speakerRef: `e:${i}`, casting: { gender: "female" } }).slug)
	})
	it("casting role narrator-like prefers a label naming a narrator", () => {
		const candidates = [c("bruno"), c("mira"), c("sol", { useCase: "Narration" })]
		expect(run({ candidates, casting: { role: "narrator-like" } }).slug).toBe("sol")
	})
	it("casting with no matches anywhere filters nothing", () => {
		const r = run({ casting: { gender: "nonbinary" } })
		expect(["mira", "sol"]).toContain(r.slug)
	})
})
