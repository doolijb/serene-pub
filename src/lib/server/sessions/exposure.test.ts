/**
 * 🚧 The exposure cascade of a session's genre settings (A10, R1, R32;
 * lane 5b): locks, reach, ask at start, fixed at start — and the cascade the
 * settings document and every run read (`cascadeFields`).
 */
import { describe, expect, it } from "vitest"
import { setting, type FieldDecl } from "@serene-pub/sdk"
import { resolveGenreSettings } from "./exposure"
import { cascadeFields } from "$lib/server/pipelines/entities/sessionGenres"

const FIELDS: Record<string, FieldDecl> = {
	tone: { type: "enum", of: ["grounded", "gentle"], default: "grounded", label: { en: "Tone" } } as FieldDecl,
	difficulty: { type: "enum", of: ["easy", "normal"], default: "normal", label: { en: "Difficulty" } } as FieldDecl,
	secret: { type: "string", default: "x", reach: "admin", label: { en: "Secret" } } as FieldDecl,
	rigour: { type: "enum", of: ["prose", "scripts"], default: "prose", reach: "owner", fixedAtStart: true } as FieldDecl
}
const byKey = (list: ReturnType<typeof resolveGenreSettings>) => Object.fromEntries(list.map((s) => [s.key, s]))

describe("the genre's settings, resolved (A10)", () => {
	it("the lowest layer with a value answers; a field reaches the owner unless it says admin", () => {
		const s = byKey(resolveGenreSettings(FIELDS, { tone: "gentle" }, null, { difficulty: "easy" }, "session"))
		expect(s.tone).toMatchObject({ value: "gentle", from: "genre", ownerSees: true, inherited: "gentle" })
		expect(s.difficulty).toMatchObject({ value: "easy", from: "session", inherited: "normal" })
		expect(s.secret).toMatchObject({ value: "x", reach: "admin", ownerSees: false })
	})

	it("a lock stops every layer below it — the stored value is not read, the owner does not see it", () => {
		const s = byKey(
			resolveGenreSettings(FIELDS, {}, { tone: setting("gentle", { lock: true }) }, { tone: "grounded" }, "session")
		)
		expect(s.tone).toMatchObject({ value: "gentle", lockedAt: "preset", ownerSees: false, from: "preset" })
		const g = byKey(
			resolveGenreSettings(FIELDS, { tone: setting("grounded", { lock: true }) }, { tone: "gentle" }, {}, "session")
		)
		expect(g.tone).toMatchObject({ value: "grounded", lockedAt: "genre" })
	})

	it("askAtStart places an owner-open setting on the start form; a locked one is never asked", () => {
		const start = byKey(
			resolveGenreSettings(
				FIELDS,
				{ difficulty: setting("easy", { askAtStart: true }) },
				{ tone: setting("gentle", { askAtStart: true, lock: true }) },
				{},
				"start"
			)
		)
		expect(start.difficulty).toMatchObject({ askAtStart: true, value: "easy" })
		expect(start.tone.askAtStart).toBe(false)
		expect(start.secret.askAtStart).toBe(false)
	})

	it("fixed at start (R32): asked at start when open to the owner, read-only for everyone after", () => {
		const start = byKey(resolveGenreSettings(FIELDS, {}, null, {}, "start"))
		expect(start.rigour).toMatchObject({ askAtStart: true, ownerSees: true })
		expect(start.rigour.fixed).toBeUndefined()
		const after = byKey(resolveGenreSettings(FIELDS, {}, null, { rigour: "scripts" }, "session"))
		expect(after.rigour).toMatchObject({ value: "scripts", fixed: true, ownerSees: false, askAtStart: false })
		// Locked above: taken, never asked.
		const locked = byKey(resolveGenreSettings(FIELDS, {}, { rigour: setting("scripts", { lock: true }) }, {}, "start"))
		expect(locked.rigour).toMatchObject({ value: "scripts", lockedAt: "preset", askAtStart: false })
	})
})

describe("cascadeFields — what every run reads (A10)", () => {
	const declared = { tone: { default: "grounded" }, difficulty: { default: "normal" } }

	it("session > preset > genre > the field's default, values read through SettingValue", () => {
		expect(
			cascadeFields({ declared, pinned: { tone: "gentle" }, preset: { difficulty: { value: "easy" } }, stored: {} })
		).toEqual({ tone: "gentle", difficulty: "easy" })
		expect(cascadeFields({ declared, pinned: {}, preset: { tone: "gentle" }, stored: { tone: "grounded" } })).toEqual({
			tone: "grounded",
			difficulty: "normal"
		})
	})

	it("a locked value wins over every layer below it", () => {
		expect(
			cascadeFields({
				declared,
				pinned: {},
				preset: { tone: setting("gentle", { lock: true }) },
				stored: { tone: "grounded" }
			})
		).toEqual({ tone: "gentle", difficulty: "normal" })
		expect(
			cascadeFields({
				declared,
				pinned: { tools: setting([], { lock: true }) },
				preset: { tools: ["search"] },
				stored: {}
			})
		).toEqual({ tone: "grounded", difficulty: "normal", tools: [] })
	})

	it("a pinned key with no field is what every run reads; a stored undeclared key is never a field", () => {
		expect(cascadeFields({ declared, pinned: { tools: [] }, preset: { tools: ["search"] }, stored: { stray: 1 } })).toEqual({
			tone: "grounded",
			difficulty: "normal",
			tools: ["search"]
		})
	})
})
