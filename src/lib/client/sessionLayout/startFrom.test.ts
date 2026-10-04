/**
 * The layout editor's Start from pane, as words and groups (brief 4 of
 * `PLAN-layout-one-format-2026-09-28`): the cards grouped by who brought
 * them, the status line read off the session's provenance, the **Updated**
 * sentence, and what each confirmation says it replaces (owner LB for a
 * copy, LC for Start from scratch).
 */
import { describe, expect, test } from "vitest"
import {
	cardMenu,
	copyConfirm,
	copyTarget,
	deleteConfirm,
	groupLayoutPresets,
	newSessionChoice,
	newSessionLayoutOf,
	provenanceText,
	reCopyAsk,
	saveChangesConfirm,
	sharedMark,
	unshareAsks,
	unshareConfirm,
	updatedSentence,
	type CardMenuContext
} from "./startFrom"

type Preset = Sockets.Sessions.LayoutPreset

function preset(over: Partial<Preset> & { id: number; name: string }): Preset {
	return {
		genreId: "core:genre/adventure",
		origin: "core",
		slug: over.name.toLowerCase().replace(/\W+/g, "-"),
		description: null,
		pluginId: null,
		pluginName: null,
		isGenreDefault: false,
		visibility: "shared",
		mine: false,
		authorName: null,
		isNewSessionLayout: false,
		layout: {},
		layoutUpdatedAt: "2026-09-29T00:00:00.000Z",
		...over
	}
}

const DEFAULT = preset({ id: 1, name: "Adventure", slug: "default", isGenreDefault: true })
const CINEMATIC = preset({ id: 2, name: "Cinematic" })
const BOARD = preset({
	id: 3,
	name: "Wide board",
	origin: "plugin",
	pluginId: "showcase.battleship",
	pluginName: "Battleship"
})
const ATLAS = preset({
	id: 6,
	name: "Atlas",
	origin: "plugin",
	pluginId: "acme.maps",
	pluginName: "Acme Maps"
})
const MINE = preset({
	id: 4,
	name: "Lighthouse table",
	origin: "user",
	visibility: "private",
	mine: true,
	authorName: "Wren"
})
const SHARED = preset({ id: 5, name: "Harbour", origin: "user", authorName: "Ash" })

describe("groupLayoutPresets", () => {
	test("genre default layout, then Serene Pub's, each plugin's by name, yours, and shared with you", () => {
		const groups = groupLayoutPresets([SHARED, MINE, BOARD, CINEMATIC, ATLAS, DEFAULT])
		expect(groups.map((g) => [g.label, g.presets.map((p) => p.id)])).toEqual([
			["Genre default layout", [1]],
			["From Serene Pub", [2]],
			["From Acme Maps", [6]],
			["From Battleship", [3]],
			["Your layouts", [4]],
			["Shared with you", [5]]
		])
	})

	test("a plugin genre's own default is the genre default layout, not the plugin's group", () => {
		const own = preset({ ...BOARD, id: 9, name: "Board", slug: "default", isGenreDefault: true })
		const groups = groupLayoutPresets([own, BOARD])
		expect(groups.map((g) => g.label)).toEqual(["Genre default layout", "From Battleship"])
	})

	test("no rows, no groups: an empty group is never drawn", () => {
		expect(groupLayoutPresets([])).toEqual([])
		expect(groupLayoutPresets([MINE]).map((g) => g.label)).toEqual(["Your layouts"])
	})
})

describe("the status line, from provenance", () => {
	test("says where this session's layout was copied from", () => {
		expect(provenanceText(DEFAULT)).toBe("Started from the genre default layout")
		expect(provenanceText(CINEMATIC)).toBe("Started from “Cinematic” (from Serene Pub)")
		expect(provenanceText(BOARD)).toBe("Started from “Wide board” (from Battleship)")
		expect(provenanceText(MINE)).toBe("Started from your layout “Lighthouse table”")
		expect(provenanceText(SHARED)).toBe("Started from “Harbour” (shared by Ash)")
	})

	test("scratch, or a source that is gone, is the session's own layout", () => {
		expect(provenanceText(null)).toBe("Your own layout")
	})

	test("the Updated sentence names who changed it", () => {
		expect(updatedSentence(BOARD)).toBe(
			"Battleship has updated “Wide board” since this session copied it."
		)
		expect(updatedSentence(CINEMATIC)).toBe(
			"Serene Pub has updated “Cinematic” since this session copied it."
		)
		expect(updatedSentence(DEFAULT)).toBe(
			"Serene Pub has updated the genre default layout since this session copied it."
		)
		expect(updatedSentence(MINE)).toBe(
			"You have updated “Lighthouse table” since this session copied it."
		)
		expect(updatedSentence(SHARED)).toBe(
			"Ash has updated “Harbour” since this session copied it."
		)
	})

	test("the offer re-copies the source: Reset for the genre default layout, else Start again", () => {
		expect(reCopyAsk(DEFAULT)).toEqual({ kind: "reset", preset: DEFAULT })
		expect(reCopyAsk(BOARD)).toEqual({ kind: "again", preset: BOARD })
	})
})

describe("what each confirmation says it replaces", () => {
	/**
	 * LB, said as it is built: only what the layout CARRIES (a widget's
	 * settings or style) replaces this session's own; a widget it places at
	 * its defaults carries nothing, so nothing of the session's is reset.
	 */
	const LB =
		"Where it brings its own settings or style for a widget, those replace yours. Everything else you've set is kept."

	test("a card: a copy of it, and the incoming layout wins only for what it names (LB)", () => {
		const c = copyConfirm({ kind: "card", preset: BOARD })
		expect(c.title).toBe("Start from “Wide board”?")
		expect(c.lines).toContain("This replaces this session's layout with a copy of “Wide board”.")
		expect(c.lines).toContain(LB)
		expect(c.confirmLabel).toBe("Use this layout")
		expect(copyTarget({ kind: "card", preset: BOARD })).toBe(3)
	})

	test("Reset and Start again say a fresh copy", () => {
		const reset = copyConfirm({ kind: "reset", preset: DEFAULT })
		expect(reset.title).toBe("Reset to the genre default layout?")
		expect(reset.lines).toContain(
			"This replaces this session's layout with a fresh copy of the genre default layout."
		)
		expect(reset.lines).toContain(LB)
		expect(reset.confirmLabel).toBe("Reset layout")

		const again = copyConfirm({ kind: "again", preset: MINE })
		expect(again.title).toBe("Start again from “Lighthouse table”?")
		expect(again.lines).toContain(
			"This replaces this session's layout with a fresh copy of “Lighthouse table”."
		)
		expect(again.confirmLabel).toBe("Start again")
	})

	test("Start from scratch: the minimal setup, every widget back at its defaults (LC)", () => {
		const c = copyConfirm({ kind: "scratch" }, "Messages")
		expect(c.title).toBe("Start from scratch?")
		expect(c.lines).toContain(
			"This replaces this session's layout with the least it needs: the Messages widget and this genre's panels, where they go by default."
		)
		expect(c.lines).toContain(
			"Every widget's settings and style go back to their defaults."
		)
		expect(c.lines.join(" ")).not.toContain("are kept")
		expect(copyTarget({ kind: "scratch" })).toBeNull()
	})

	test("Reset on a genre that ships no layout of its own is scratch, and says so", () => {
		const c = copyConfirm({ kind: "reset", preset: null }, "Board")
		expect(c.title).toBe("Reset to the genre default layout?")
		expect(c.lines[0]).toBe(
			"This genre has no default layout of its own, so this starts from scratch: the Board widget and this genre's panels, where they go by default."
		)
		expect(c.lines).toContain("Every widget's settings and style go back to their defaults.")
		expect(copyTarget({ kind: "reset", preset: null })).toBeNull()
	})

	test("every copy says the editor cannot take it back, and how to keep what is there", () => {
		for (const ask of [
			{ kind: "card", preset: BOARD },
			{ kind: "again", preset: MINE },
			{ kind: "reset", preset: DEFAULT },
			{ kind: "scratch" }
		] as const) {
			expect(copyConfirm(ask).lines.at(-1)).toBe(
				"The editor's Cancel won't bring the current layout back. To keep it, save it as a new layout first."
			)
		}
	})

	test("a copy's confirm is the primary; scratch, which only clears, is drawn in error", () => {
		for (const ask of [
			{ kind: "card", preset: BOARD },
			{ kind: "again", preset: MINE },
			{ kind: "reset", preset: DEFAULT }
		] as const)
			expect(copyConfirm(ask).tone).toBe("primary")
		expect(copyConfirm({ kind: "scratch" }).tone).toBe("danger")
		expect(copyConfirm({ kind: "reset", preset: null }).tone).toBe("danger")
	})

	test("delete: sessions keep their layout; new-session users get the genre default layout", () => {
		const asking = deleteConfirm(MINE, null)
		expect(asking.title).toBe("Delete “Lighthouse table”?")
		expect(asking.pending).toBe(true)
		expect(asking.lines).toEqual(["Checking where it is used…"])

		const quiet = deleteConfirm(MINE, { sessions: 3, newSessionLayoutUsers: 0 })
		expect(quiet.pending).toBe(false)
		expect(quiet.tone).toBe("danger")
		expect(quiet.confirmLabel).toBe("Delete layout")
		expect(quiet.lines).toEqual(["Sessions that started from it keep their layout."])

		expect(deleteConfirm(MINE, { sessions: 0, newSessionLayoutUsers: 1 }).lines).toEqual([
			"Sessions that started from it keep their layout.",
			"1 person uses it for new sessions; they'll get the genre default layout instead."
		])
		expect(deleteConfirm(MINE, { sessions: 0, newSessionLayoutUsers: 2 }).lines[1]).toBe(
			"2 people use it for new sessions; they'll get the genre default layout instead."
		)

		// The count could not be read: say so, and do not hold the delete.
		const unknown = deleteConfirm(MINE, {
			sessions: 0,
			newSessionLayoutUsers: 0,
			unknown: true
		})
		expect(unknown.pending).toBe(false)
		expect(unknown.lines).toEqual([
			"Sessions that started from it keep their layout.",
			"Couldn't check whether anyone uses it for new sessions; anyone who does gets the genre default layout instead."
		])
	})
})

/* ── brief 6b: the card menu, the new-session layout, Save changes to ── */

describe("the card menu", () => {
	const ctx = (over: Partial<CardMenuContext> = {}): CardMenuContext => ({
		genreName: "Adventure",
		isGuest: false,
		isAdmin: false,
		newSessionLayoutId: DEFAULT.id,
		...over
	})
	/** The actions a card offers, separators as "|". */
	const actions = (p: Preset, c: CardMenuContext) =>
		cardMenu(p, c).map((e) => (e === "separator" ? "|" : e.action))
	const labels = (p: Preset, c: CardMenuContext) =>
		cardMenu(p, c).flatMap((e) => (e === "separator" ? [] : [e.label]))

	test("every card can be used for new sessions of the genre and copied; only yours can be shared, renamed and deleted", () => {
		expect(labels(CINEMATIC, ctx())).toEqual(["Use for new Adventure sessions", "Make a copy"])
		expect(actions(BOARD, ctx())).toEqual(["new-session", "copy"])
		expect(actions(SHARED, ctx())).toEqual(["new-session", "copy"])
		expect(labels(MINE, ctx())).toEqual([
			"Use for new Adventure sessions",
			"Make a copy",
			"Share with everyone on this pub",
			"Rename",
			"Delete"
		])
		expect(actions(MINE, ctx())).toEqual(["new-session", "copy", "|", "share", "rename", "|", "delete"])
		// Once shared, the same slot takes it back.
		expect(actions({ ...MINE, visibility: "shared" }, ctx())).toContain("unshare")
		expect(labels({ ...MINE, visibility: "shared" }, ctx())).toContain("Stop sharing")
	})

	test("the new-session layout offers to stop; what new sessions already start from offers nothing", () => {
		const chosen = { ...MINE, isNewSessionLayout: true }
		expect(labels(chosen, ctx({ newSessionLayoutId: MINE.id }))[0]).toBe(
			"Stop using for new sessions"
		)
		// Nothing chosen: the genre default layout is what new sessions get.
		expect(actions(DEFAULT, ctx())).toEqual(["copy"])
		// Chosen explicitly, it is still what they get: nothing to stop.
		expect(
			actions({ ...DEFAULT, isNewSessionLayout: true }, ctx({ newSessionLayoutId: DEFAULT.id }))
		).toEqual(["copy"])
		// Another layout chosen: the genre default layout can be chosen back.
		expect(actions(DEFAULT, ctx({ newSessionLayoutId: MINE.id }))).toEqual(["new-session", "copy"])
	})

	test("a genre with no name yet still says what it does", () => {
		expect(labels(CINEMATIC, ctx({ genreName: null }))[0]).toBe(
			"Use for new sessions of this genre"
		)
	})

	test("a guest in this session is offered no share control, on or off", () => {
		expect(actions(MINE, ctx({ isGuest: true }))).toEqual(["new-session", "copy", "|", "rename", "|", "delete"])
		expect(actions({ ...MINE, visibility: "shared" }, ctx({ isGuest: true }))).not.toContain(
			"unshare"
		)
	})

	test("an admin manages someone else's SHARED layout, never a shipped one", () => {
		expect(actions(SHARED, ctx({ isAdmin: true }))).toEqual([
			"new-session",
			"copy",
			"|",
			"unshare",
			"rename",
			"|",
			"delete"
		])
		expect(actions(CINEMATIC, ctx({ isAdmin: true }))).toEqual(["new-session", "copy"])
		expect(actions(BOARD, ctx({ isAdmin: true }))).toEqual(["new-session", "copy"])
	})

	test("an admin's Stop sharing on someone else's layout says whose it is, and asks", () => {
		expect(labels(SHARED, ctx({ isAdmin: true }))).toContain("Stop sharing Ash's layout")
		// Their own shared layout: the plain words, and no question (they can share it again).
		expect(labels({ ...MINE, visibility: "shared" }, ctx({ isAdmin: true }))).toContain(
			"Stop sharing"
		)
		expect(unshareAsks({ ...MINE, visibility: "shared" })).toBe(false)
		expect(unshareAsks(SHARED)).toBe(true)
		const q = unshareConfirm(SHARED)
		expect(q.title).toBe("Stop sharing “Harbour”?")
		expect(q.lines.join(" ")).toContain("Ash's private layout again")
		expect(q.lines.join(" ")).toContain("Only Ash can share it again.")
		expect(q.lines.join(" ")).toContain("Sessions that started from it keep their layout.")
		expect(q.confirmLabel).toBe("Stop sharing")
		// It only takes away (STYLE-GUIDE §6.6): drawn in error.
		expect(q.tone).toBe("danger")
		// No author on the wire: still says it is someone else's.
		expect(unshareConfirm({ ...SHARED, authorName: null }).lines.join(" ")).toContain(
			"its author's private layout again"
		)
	})

	test("an admin deleting someone else's layout is told whose it is", () => {
		const q = deleteConfirm(SHARED, { sessions: 0, newSessionLayoutUsers: 0 })
		expect(q.lines[0]).toBe("It's Ash's layout: deleting it takes it from Ash too.")
		expect(deleteConfirm(MINE, { sessions: 0, newSessionLayoutUsers: 0 }).lines.join(" ")).not.toContain(
			"takes it from"
		)
	})
})

describe("the new-session layout a card's menu chooses", () => {
	test("the genre default layout's card clears the choice, rather than pinning its row", () => {
		// One stored way to say "the genre default layout": no row. A pin to its
		// id would stop following the genre if its default row were replaced.
		expect(newSessionChoice(DEFAULT)).toBeNull()
		expect(newSessionChoice(MINE)).toBe(MINE.id)
		expect(newSessionChoice(SHARED)).toBe(SHARED.id)
	})
})

describe("a layout of yours that is shared", () => {
	test("is marked in the same words on both editors", () => {
		expect(sharedMark({ ...MINE, visibility: "shared" })).toBe("Shared")
		expect(sharedMark(MINE)).toBeNull()
		// Someone else's shared layout is marked by whose it is instead.
		expect(sharedMark(SHARED)).toBeNull()
	})
})

describe("which card is the new-session layout", () => {
	test("the chosen one, else the genre default layout, else none", () => {
		expect(newSessionLayoutOf([DEFAULT, MINE])?.id).toBe(DEFAULT.id)
		expect(newSessionLayoutOf([DEFAULT, { ...MINE, isNewSessionLayout: true }])?.id).toBe(MINE.id)
		expect(newSessionLayoutOf([CINEMATIC, MINE])).toBeNull()
	})
})

describe("Save changes to", () => {
	test("says what it saves and that other sessions only see it as updated", () => {
		const c = saveChangesConfirm(MINE, false)
		expect(c.title).toBe("Save changes to “Lighthouse table”?")
		expect(c.lines).toEqual([
			"This saves this session's layout into “Lighthouse table”, with the settings and styles you've changed on the widgets it shows.",
			"Sessions that started from it keep their own layout. They'll show it as updated, to start again from if they want."
		])
		expect(c.confirmLabel).toBe("Save changes")
		expect(c.tone).toBe("primary")
		expect(c.alternative).toBeUndefined()
	})

	test("over a layout this session reads as Updated: warns that it replaces those changes, and offers Start again instead", () => {
		const c = saveChangesConfirm(MINE, true)
		expect(c.lines).toEqual([
			"You have updated “Lighthouse table” since this session copied it.",
			"Saving here replaces those changes with this session's layout.",
			"To keep them, start again from “Lighthouse table” instead."
		])
		expect(c.confirmLabel).toBe("Save over them")
		expect(c.tone).toBe("danger")
		expect(c.alternative).toBe("Start again instead")
	})
})
