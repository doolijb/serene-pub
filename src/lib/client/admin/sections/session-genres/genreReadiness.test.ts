import { describe, expect, it } from "vitest"
import { genreReadiness, type GenreDetail } from "./genreReadiness"

const RESPOND = "core:event/message-respond@1"
const OPENING = "core:event/session-opening@1"

type Genre = NonNullable<GenreDetail["genre"]>
function detail(genre: Partial<Genre> = {}, bindings: Record<string, { spec: string }> = {}): GenreDetail {
	return {
		genre: {
			genreId: "acme.lab:genre/quest",
			name: "Quest",
			description: "A party on the road.",
			family: "roleplay",
			shape: {},
			createSpecSlug: "acme.lab:spec/quest-create",
			enabled: true,
			defaultPresetId: 7,
			origin: "pub",
			editable: true,
			fields: {},
			hasState: true,
			layout: { id: 3, slug: "quest", name: "Quest layout" },
			pluginsEnabled: true,
			...genre
		},
		slots: [
			{ event: RESPOND, required: true, open: false, candidates: [{ slug: "acme.lab:spec/quest-respond", name: "Reply" }] },
			{ event: OPENING, required: true, open: false, candidates: [] },
			{ event: "core:event/action@1", required: false, open: true, candidates: [] }
		],
		presets: [
			{
				id: 7,
				name: "Quest",
				description: null,
				genreId: "acme.lab:genre/quest",
				bindings,
				primarySlug: null,
				configSelections: {},
				includedActions: null,
				enabled: true,
				isDefault: true,
				isImmutable: false
			} as unknown as Sockets.SessionAdmin.PresetRow
		],
		sessionCount: 0
	}
}

const line = (r: ReturnType<typeof genreReadiness>, id: string) => r.lines.find((l) => l.id === id)!

describe("genreReadiness", () => {
	it("lists the nine lines in the plan's order", () => {
		expect(genreReadiness(detail()).lines.map((l) => l.id)).toEqual([
			"name", "fields", "create", "reply", "preset", "state", "layout", "events", "export"
		])
	})

	it("the first unticked required line is next, and only it carries an action", () => {
		const r = genreReadiness(detail())
		expect(r.next).toBe("fields")
		expect(line(r, "fields").action).toEqual({ kind: "section", section: "session-fields", label: "Add a field" })
		expect(r.lines.filter((l) => l.action).map((l) => l.id)).toEqual(["fields"])
	})

	it("reads the reply off the default preset's bindings", () => {
		const fields = { goal: { type: "string" as const, label: "Goal" } }
		const unbound = genreReadiness(detail({ fields }))
		expect(unbound.next).toBe("reply")
		expect(line(unbound, "reply").action?.label).toBe("Bind the reply")

		const bound = genreReadiness(detail({ fields }, { [RESPOND]: { spec: "acme.lab:spec/quest-respond" } }))
		expect(line(bound, "reply").done).toBe(true)
		// The opening event is required and unbound.
		expect(bound.next).toBe("events")
		expect(line(bound, "events").detail).toBe("1 required event is unbound.")
	})

	it("with every required line green, export is offered next", () => {
		const r = genreReadiness(
			detail(
				{ fields: { goal: { type: "string", label: "Goal" } } },
				{ [RESPOND]: { spec: "a" }, [OPENING]: { spec: "b" } }
			)
		)
		expect(r.lines.filter((l) => !l.optional).every((l) => l.done)).toBe(true)
		expect(r.next).toBe("export")
		expect(line(r, "export").action).toEqual({ kind: "export", label: "Export as plugin…" })
	})

	it("offers nothing more when plugins are off", () => {
		const r = genreReadiness(
			detail(
				{ fields: { goal: { type: "string" } }, pluginsEnabled: false },
				{ [RESPOND]: { spec: "a" }, [OPENING]: { spec: "b" } }
			)
		)
		expect(r.next).toBeNull()
		expect(line(r, "export").detail).toMatch(/switched off/)
	})

	it("with no default preset, reply and events point at the Availability card", () => {
		const d = detail({ fields: { goal: { type: "string" } } })
		d.genre!.defaultPresetId = null
		const r = genreReadiness(d)
		expect(r.next).toBe("reply")
		expect(line(r, "reply").action).toEqual({ kind: "section", section: "availability", label: "Pick a default preset" })
		expect(line(r, "preset").done).toBe(false)
		expect(line(r, "events").done).toBe(false)
	})

	it("a missing description, state and layout read gold", () => {
		const d = detail({ hasState: false, layout: null })
		d.genre!.description = ""
		const r = genreReadiness(d)
		expect(r.next).toBe("name")
		expect(line(r, "state").done).toBe(false)
		expect(line(r, "layout").detail).toBe("Sessions open in the app's default layout.")
	})
})
