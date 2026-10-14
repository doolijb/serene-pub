/**
 * Core's remote Who's here (PLAN-core-widgets W10) — the built module
 * (`@serene-pub/core-catalog/components/attendance.js`) mounted through the
 * SDK's component harness in core's box, posted what the page posts it: the
 * session's attendance as the page projects it (`projectAttendance` — the
 * server's push, the personas from the session payload, typing from the
 * typing pings), the cast from the page's own projection
 * (`projectCharacters`), the viewer, and only the base sections its
 * declaration reads. A persona's press is answered by the page's own
 * `open-character` answer.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { ViewerV1 } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { coreDefaultWidgets } from "./coreWidgets"
import {
	projectCharacters,
	type CharacterCard,
	type CharactersSourceSession
} from "./projections/characters"
import { personaOwnersOf, projectAttendance } from "./projections/attendance"
import { answerOpenCharacter } from "./requests/openCharacter"

const require = createRequire(import.meta.url)
const BUILT = require.resolve(
	"@serene-pub/core-catalog/components/attendance.js"
)
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/attendance\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "attendance")!

/* ── one session, as the page holds it ─────────────────────────────────── */

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const FACE = `/media/${U(1)}?r=1`

const wren: CharacterCard = { id: 3, userId: 10, name: "Wren" }
const kit: CharacterCard = {
	id: 8,
	userId: 10,
	name: "Kit",
	avatarMedia: { uuid: U(1), rev: 1 }
}
const sable: CharacterCard = { id: 9, userId: 30, name: "Sable" }

const session: CharactersSourceSession = {
	userId: 10,
	sessionCharacters: [
		{ isActive: true, removedAt: null, position: 0, character: wren }
	],
	sessionPersonas: [
		{ removedAt: null, position: 0, persona: kit },
		{ removedAt: null, position: 1, persona: sable }
	],
	sessionMessages: []
}

const NOW = Date.now()
const MIRA = {
	userId: 10,
	name: "Mira",
	role: "owner" as const,
	here: true,
	lastSeenAt: NOW
}
const MARCO = {
	userId: 30,
	name: "Marco",
	role: "guest" as const,
	here: true,
	lastSeenAt: NOW
}
const ANA = {
	userId: 40,
	name: "Ana",
	role: "guest" as const,
	here: false,
	lastSeenAt: NOW - 5 * 60_000
}

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }

/** What the page's envelope hands the widget: the push, with personas and typing. */
const attendance = (
	people: Sockets.Sessions.Attendance.Person[],
	typingPersonaIds: number[] = []
) =>
	projectAttendance({
		sessionId: 1,
		pushed: { sessionId: 1, people },
		personaOwners: personaOwnersOf(session as never),
		typingPersonaIds
	})

/* ── the remote, as the page mounts it ─────────────────────────────────── */

const opened: number[] = []
const views: MountedComponent[] = []

async function mount(
	o: {
		people?: Sockets.Sessions.Attendance.Person[]
		typing?: number[]
		viewer?: ViewerV1
		settings?: Record<string, unknown>
	} = {}
) {
	const viewer = o.viewer ?? OWNER
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Taproom" },
			settings: o.settings ?? {},
			viewer,
			attendance: attendance(o.people ?? [MIRA, MARCO, ANA], o.typing),
			scoped: {
				characters: projectCharacters({
					session,
					viewerUserId: viewer.userId,
					sceneImages: { left: null, right: null }
				})
			}
		},
		requests: (kind, params) => {
			if (kind === "open-character")
				return answerOpenCharacter(params, {
					castMemberOf: () => null,
					openCastMember: () => {},
					openCharactersPanel: () => {},
					viewCharacter: (id) => opened.push(id)
				})
			throw new Error(`not asked: ${kind}`)
		}
	})
	views.push(view)
	await view.settle()
	return view
}

afterAll(async () => {
	for (const v of views) await v.unmount()
})

const part = (name: string) => `[data-widget-part~="attendance.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const group = (view: MountedComponent, which: "here" | "away") =>
	view.query(`${part("group")}[data-group="${which}"]`)
const rows = (view: MountedComponent, which: "here" | "away") =>
	[...(group(view, which)?.querySelectorAll(part("person")) ?? [])].map(
		(r) => ({
			name: text(r.querySelector(part("name"))),
			you: !!r.querySelector(part("you")),
			role: text(r.querySelector(part("role"))),
			personas: [...r.querySelectorAll(part("persona"))].map((p) =>
				text(p)
			),
			typing: !!r.querySelector(part("typing")),
			away: text(r.querySelector(part("away")))
		})
	)

describe("core's remote Who's here", () => {
	test(
		"Here lists you first, then the others, each with the personas they write as; Away says when they were last here",
		{ timeout: 120_000 },
		async () => {
			const view = await mount()
			expect(view.refused).toEqual([])
			expect(
				text(group(view, "here")?.querySelector(part("group-head")))
			).toBe("Here")
			expect(rows(view, "here")).toEqual([
				{
					name: "Mira",
					you: true,
					role: "Owner",
					personas: ["Kit"],
					typing: false,
					away: null
				},
				{
					name: "Marco",
					you: false,
					role: "Guest",
					personas: ["Sable"],
					typing: false,
					away: null
				}
			])
			expect(rows(view, "away")).toEqual([
				{
					name: "Ana",
					you: false,
					role: "Guest",
					personas: [],
					typing: false,
					away: "Last here 5m ago"
				}
			])
			// Kit's face from the cast; Sable has none and draws the blank.
			const faces = view.queryAll(part("face"))
			expect(faces[0]!.tagName.toLowerCase()).toBe("img")
			expect(faces[0]!.getAttribute("src")).toBe(FACE)
			expect(faces[1]!.hasAttribute("data-blank")).toBe(true)
			expect(view.query(part("empty"))).toBeNull()
			expect(view.errors).toEqual([])
		}
	)

	test(
		"the typing pulse follows the typing map — on, then off when the ping expires",
		{ timeout: 120_000 },
		async () => {
			const view = await mount({ typing: [9] })
			expect(rows(view, "here").map((r) => [r.name, r.typing])).toEqual([
				["Mira", false],
				["Marco", true]
			])
			expect(text(view.query(part("typing")))).toBe("typing…")
			await view.push("attendance", attendance([MIRA, MARCO, ANA], []))
			await view.settle()
			expect(view.query(part("typing"))).toBeNull()
		}
	)

	test(
		"a persona's press opens its sheet",
		{ timeout: 120_000 },
		async () => {
			const view = await mount()
			opened.length = 0
			const sable = view
				.queryAll(part("persona"))
				.find((b) => text(b) === "Sable")!
			await view.click(sable)
			await view.settle()
			expect(opened).toEqual([9])
			expect(view.query(part("alert"))).toBeNull()
		}
	)

	test("faces off: names only", { timeout: 120_000 }, async () => {
		const view = await mount({ settings: { faces: false } })
		expect(view.queryAll(part("face"))).toEqual([])
		expect(rows(view, "here")[0]!.personas).toEqual(["Kit"])
	})

	test("showAway off: no Away group", { timeout: 120_000 }, async () => {
		const view = await mount({ settings: { showAway: false } })
		expect(group(view, "away")).toBeNull()
		expect(rows(view, "here")).toHaveLength(2)
	})

	test("alone: Nobody else is here.", { timeout: 120_000 }, async () => {
		const view = await mount({
			people: [MIRA, { ...MARCO, here: false, lastSeenAt: null }]
		})
		expect(rows(view, "here").map((r) => r.name)).toEqual(["Mira"])
		expect(text(view.query(part("empty")))).toBe("Nobody else is here.")
		expect(rows(view, "away")[0]!.away).toBe("Not seen lately")
		// Before the first push: nobody at all, and the same sentence.
		await view.push("attendance", { v: 1, people: [] })
		await view.settle()
		expect(rows(view, "here")).toEqual([])
		expect(text(view.query(part("empty")))).toBe("Nobody else is here.")
	})
})

describe("the page mounts Who's here remote", () => {
	test("core's own module at /core-ui/attendance, granted the cast, reading its declaration's sections", () => {
		const widget = coreDefaultWidgets().find((p) => p.id === "attendance")!
		expect(widget.surface).toEqual({
			kind: "remote",
			owner: "core",
			component: "attendance"
		})
		expect(widget.src).toBe("/core-ui/attendance")
		expect(widget.grants).toEqual(["characters"])
		// Translations arrive on their own `strings` message, so Who's here does not read `locale`.
		expect(widget.reads).toEqual(["attendance", "viewer", "settings"])
		expect(DECL.maxInstances).toBe(1)
	})
})
