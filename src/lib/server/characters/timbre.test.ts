import { describe, expect, it } from "vitest"
import { canPickVoice, timbreOfExtensions } from "$lib/shared/characters/timbre"
import {
	TIMBRE_LIMITS,
	applyTimbreToExtensions,
	applyTimbreUpdate,
	timbreForExport,
	timbreFromImport,
	validateTimbre
} from "./timbre"

/** A stand-in database: `voicebank_voices` holds the slugs given. */
const dbWith = (slugs: string[] = []) =>
	({
		query: {
			voicebankVoices: {
				findFirst: async () => undefined as unknown
			}
		}
	}) as never as Db
const dbHolding = (slug: string) =>
	({
		query: { voicebankVoices: { findFirst: async () => ({ id: 1, slug }) } }
	}) as never as Db

const admin = { db: dbWith(), canPickVoice: true, previous: {} }
const member = { db: dbWith(), canPickVoice: false, previous: {} }

describe("validateTimbre", () => {
	it("language is lower-cased; a three-letter code is refused", async () => {
		expect(await validateTimbre({ language: "EN" }, admin)).toEqual({ ok: true, timbre: { language: "en" } })
		const r = await validateTimbre({ language: "eng" }, admin)
		expect(r.ok).toBe(false)
		expect((await validateTimbre({ language: "e" }, admin)).ok).toBe(false)
		expect((await validateTimbre({ language: 3 }, admin)).ok).toBe(false)
	})
	it("speed bounds: 0.25 and 4 pass, 0.24 and 4.01 are refused", async () => {
		for (const speed of [0.25, 4])
			expect(await validateTimbre({ settings: { speed } }, admin)).toEqual({
				ok: true,
				timbre: { settings: { speed } }
			})
		for (const speed of [0.24, 4.01]) expect((await validateTimbre({ settings: { speed } }, admin)).ok).toBe(false)
	})
	it("0 and 1 dial bounds pass; just outside is refused", async () => {
		for (const k of ["stability", "similarity", "style"] as const) {
			for (const v of [0, 1])
				expect(await validateTimbre({ settings: { [k]: v } }, admin), `${k}=${v}`).toEqual({
					ok: true,
					timbre: { settings: { [k]: v } }
				})
			for (const v of [-0.01, 1.01]) expect((await validateTimbre({ settings: { [k]: v } }, admin)).ok).toBe(false)
		}
	})
	it("NaN / Infinity / non-numbers are dropped, not refused", async () => {
		expect(
			await validateTimbre({ settings: { speed: Number.NaN, style: Infinity, stability: "1" as never } }, admin)
		).toEqual({ ok: true, timbre: null })
	})
	it("a 2000-char description passes, 2001 is refused", async () => {
		expect((await validateTimbre({ description: "x".repeat(2000) }, admin)).ok).toBe(true)
		expect(TIMBRE_LIMITS.descriptionChars).toBe(2000)
		const r = await validateTimbre({ description: "x".repeat(2001) }, admin)
		expect(r.ok).toBe(false)
	})
	it("a non-text description or non-object timbre is refused", async () => {
		expect((await validateTimbre({ description: 4 }, admin)).ok).toBe(false)
		expect((await validateTimbre("loud", admin)).ok).toBe(false)
		expect((await validateTimbre([], admin)).ok).toBe(false)
	})
	it("null clears; an empty timbre is no timbre; unknown keys are dropped", async () => {
		expect(await validateTimbre(null, admin)).toEqual({ ok: true, timbre: null })
		expect(await validateTimbre({}, admin)).toEqual({ ok: true, timbre: null })
		expect(await validateTimbre({ bogus: 1, description: " warm " }, admin)).toEqual({
			ok: true,
			timbre: { description: "warm" }
		})
	})
	it("a voice must exist in the voicebank (admin)", async () => {
		expect((await validateTimbre({ voice: "ghost" }, admin)).ok).toBe(false)
		expect(await validateTimbre({ voice: "bruno" }, { ...admin, db: dbHolding("bruno") })).toEqual({
			ok: true,
			timbre: { voice: "bruno" }
		})
	})
	it("a member cannot change the voice: the previous voice is kept, whatever was sent", async () => {
		const ctx = { ...member, db: dbHolding("bruno"), previous: { voice: "old" } }
		expect(await validateTimbre({ voice: "bruno", description: "x" }, ctx)).toEqual({
			ok: true,
			timbre: { voice: "old", description: "x" }
		})
		expect(await validateTimbre(null, ctx)).toEqual({ ok: true, timbre: { voice: "old" } })
		expect(await validateTimbre({ voice: "bruno" }, member)).toEqual({ ok: true, timbre: null })
	})
})

describe("applyTimbreToExtensions / applyTimbreUpdate", () => {
	it("sets or removes the timbre, keeping other keys, never mutating", () => {
		const ext = { other: 1, serenepub: { keep: true } }
		const set = applyTimbreToExtensions(ext, { description: "d" })
		expect(set).toEqual({ other: 1, serenepub: { keep: true, timbre: { description: "d" } } })
		expect(ext).toEqual({ other: 1, serenepub: { keep: true } })
		expect(applyTimbreToExtensions(set, null)).toEqual({ other: 1, serenepub: { keep: true } })
		expect(applyTimbreToExtensions({ serenepub: { timbre: { language: "en" } } }, null)).toEqual({})
	})
	it("a save with no timbre key leaves the stored timbre untouched", async () => {
		const stored = { serenepub: { timbre: { description: "d", voice: "v" } } }
		const out = await applyTimbreUpdate({ other: 1 }, stored, { db: dbWith(), user: { isAdmin: false } })
		expect(timbreOfExtensions(out)).toEqual({ description: "d", voice: "v" })
		expect((out as { other: number }).other).toBe(1)
	})
	it("a refusal throws its reason", async () => {
		await expect(
			applyTimbreUpdate({ serenepub: { timbre: { language: "eng" } } }, {}, { db: dbWith(), user: { isAdmin: true } })
		).rejects.toThrow(/two-letter/)
	})
	it("a member's save keeps the stored voice", async () => {
		const stored = { serenepub: { timbre: { voice: "v" } } }
		const out = await applyTimbreUpdate(
			{ serenepub: { timbre: { description: "new" } } },
			stored,
			{ db: dbWith(), user: { isAdmin: false } }
		)
		expect(timbreOfExtensions(out)).toEqual({ description: "new", voice: "v" })
	})
})

describe("timbre seed", () => {
	const SEED_REASON = "Timbre seed must be a whole number from 0 to 2147483647."
	it("a whole number from 0 to the maximum is accepted", async () => {
		for (const seed of [0, 42, 2147483647])
			expect(await validateTimbre({ settings: { seed } }, admin)).toEqual({
				ok: true,
				timbre: { settings: { seed } }
			})
	})
	it("a non-integer seed is refused with the sentence", async () => {
		expect(await validateTimbre({ settings: { seed: 1.5 } }, admin)).toEqual({ ok: false, reason: SEED_REASON })
	})
	it("an out-of-range seed is refused", async () => {
		for (const seed of [-1, 2147483648]) expect((await validateTimbre({ settings: { seed } }, admin)).ok).toBe(false)
	})
	it("import keeps a good seed and drops a bad one; export keeps it", () => {
		expect(timbreFromImport({ settings: { seed: 7 } })).toEqual({ settings: { seed: 7 } })
		for (const seed of [1.5, -3, 2147483648]) expect(timbreFromImport({ settings: { seed } })).toBeNull()
		const ext = { serenepub: { timbre: { description: "warm", voice: "b", settings: { seed: 7 } } } }
		expect(timbreForExport(ext)).toEqual({ description: "warm", settings: { seed: 7 } })
		expect(timbreOfExtensions({ serenepub: { timbre: { settings: { seed: 1.5 } } } })).toEqual({})
	})
})

describe("card export / import", () => {
	const ext = { serenepub: { timbre: { description: "warm", voice: "bruno", language: "en", settings: { speed: 1.2 } } } }
	it("timbreForExport drops voice", () => {
		expect(timbreForExport(ext)).toEqual({ description: "warm", language: "en", settings: { speed: 1.2 } })
		expect(timbreForExport({ serenepub: { timbre: { voice: "only" } } })).toBeNull()
		expect(timbreForExport(null)).toBeNull()
	})
	it("timbreFromImport drops voice and sanitises silently", () => {
		expect(
			timbreFromImport({
				voice: "bruno",
				description: "  warm  ",
				language: "EN",
				settings: { speed: 99, stability: 0.5, style: Number.NaN }
			})
		).toEqual({ description: "warm", language: "en", settings: { stability: 0.5 } })
	})
	it("a malformed timbre still imports (as nothing, never a throw)", () => {
		expect(timbreFromImport({ language: "english", description: 4, settings: "loud" })).toBeNull()
		expect(timbreFromImport("junk")).toBeNull()
		expect(timbreFromImport([])).toBeNull()
		expect(timbreFromImport(null)).toBeNull()
	})
	it("an over-long imported description is cut to the limit", () => {
		expect(timbreFromImport({ description: "x".repeat(2500) })!.description!.length).toBe(2000)
	})
})

describe("canPickVoice", () => {
	it("admin only", () => {
		expect(canPickVoice({ isAdmin: true })).toBe(true)
		expect(canPickVoice({ isAdmin: false })).toBe(false)
		expect(canPickVoice({})).toBe(false)
		expect(canPickVoice(null)).toBe(false)
		expect(canPickVoice(undefined)).toBe(false)
	})
})

describe("silent", () => {
	it("is kept only as true, by anyone; a non-boolean is refused", async () => {
		expect(await validateTimbre({ silent: true }, member)).toEqual({ ok: true, timbre: { silent: true } })
		expect(await validateTimbre({ silent: false }, admin)).toEqual({ ok: true, timbre: null })
		expect((await validateTimbre({ silent: "yes" }, admin)).ok).toBe(false)
	})
	it("reads off extensions, travels on export and import", () => {
		const ext = { serenepub: { timbre: { description: "low", silent: true, voice: "v" } } }
		expect(timbreOfExtensions(ext).silent).toBe(true)
		expect(timbreForExport(ext)).toEqual({ description: "low", silent: true })
		expect(timbreFromImport({ silent: true })).toEqual({ silent: true })
		expect(timbreFromImport({ silent: "true" })).toBeNull()
	})
})

describe("narration voice and description (speech follow-ups C8)", () => {
	it("a narrationDescription is dropped silently on update, never refused", async () => {
		expect(await validateTimbre({ narrationDescription: "  dry  " }, member)).toEqual({ ok: true, timbre: null })
		expect(await validateTimbre({ narrationDescription: 4, description: "d" }, member)).toEqual({
			ok: true,
			timbre: { description: "d" }
		})
	})
	it("speakerBoost round-trips: validated, imported, exported, read back", async () => {
		expect(await validateTimbre({ settings: { speakerBoost: true } }, admin)).toEqual({
			ok: true,
			timbre: { settings: { speakerBoost: true } }
		})
		expect(await validateTimbre({ settings: { speakerBoost: false } }, admin)).toEqual({
			ok: true,
			timbre: { settings: { speakerBoost: false } }
		})
		expect((await validateTimbre({ settings: { speakerBoost: "yes" } }, admin)).ok).toBe(false)
		expect(timbreFromImport({ settings: { speakerBoost: true } })).toEqual({ settings: { speakerBoost: true } })
		expect(timbreFromImport({ settings: { speakerBoost: "yes" } })).toBeNull()
		const ext = { serenepub: { timbre: { settings: { speakerBoost: true } } } }
		expect(timbreForExport(ext)).toEqual({ settings: { speakerBoost: true } })
		expect(timbreOfExtensions(ext).settings?.speakerBoost).toBe(true)
	})
	it("an admin's narrationVoice must exist; refused like voice", async () => {
		expect(await validateTimbre({ narrationVoice: "ghost" }, admin)).toEqual({
			ok: false,
			reason: 'No voice named "ghost" in the voicebank.'
		})
		expect(await validateTimbre({ narrationVoice: " nora " }, { ...admin, db: dbHolding("nora") })).toEqual({
			ok: true,
			timbre: { narrationVoice: "nora" }
		})
		expect(await validateTimbre({ narrationVoice: "  " }, admin)).toEqual({ ok: true, timbre: null })
	})
	it("a member's narrationVoice is kept as stored, never taken from the input, and survives a clear", async () => {
		const previous = { voice: "v", narrationVoice: "nora" }
		expect(await validateTimbre({ narrationVoice: "other", description: "d" }, { ...member, previous })).toEqual({
			ok: true,
			timbre: { description: "d", voice: "v", narrationVoice: "nora" }
		})
		expect(await validateTimbre({ narrationVoice: "other" }, member)).toEqual({ ok: true, timbre: null })
		expect(await validateTimbre(null, { ...member, previous })).toEqual({ ok: true, timbre: previous })
	})
	it("export drops narrationVoice and never emits narrationDescription; import drops both", () => {
		const ext = { serenepub: { timbre: { voice: "v", narrationVoice: "nora", narrationDescription: "dry" } } }
		expect(timbreForExport(ext)).toBeNull()
		expect(timbreFromImport({ narrationVoice: "nora", narrationDescription: " dry " })).toBeNull()
		expect(timbreFromImport({ description: "d", narrationDescription: "dry" })).toEqual({ description: "d" })
	})
})
