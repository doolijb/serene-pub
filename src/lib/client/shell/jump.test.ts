/**
 * The two rules the whole Jump overlay reads from, pinned.
 *
 * Both are the kind of thing that fails silently rather than loudly: a
 * precedence written one line too high sends every search to the wrong list,
 * and a prefix matcher one character too greedy eats a colon out of a
 * lorebook entry's name and finds nothing. Neither shows up as an error
 * anywhere — only as a search that quietly answers the wrong question.
 */
import { describe, expect, test } from "vitest"
import {
	ADMIN_SCOPE_KEY,
	ADMIN_SCOPE_LABEL,
	createJumpCtx,
	EVERYWHERE_LABEL,
	isAdminPath,
	isDocsPath,
	isKindScopeKey,
	kindOfScope,
	parseKindPrefix,
	resolveScope,
	type JumpScope
} from "./jump.svelte"

const manual = (key: string | null, label: string): JumpScope => ({
	key,
	label,
	source: "manual"
})

describe("resolveScope", () => {
	test("a view that registered a scope owns it", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: "characters",
				viewLabel: "Characters",
				pathname: "/"
			})
		).toEqual({
			key: "characters",
			label: "Characters",
			source: "view"
		})
	})

	test("a view that registered nothing falls through to the route", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: "settings",
				viewLabel: null,
				pathname: "/admin/users"
			})
		).toEqual({
			key: ADMIN_SCOPE_KEY,
			label: ADMIN_SCOPE_LABEL,
			source: "route"
		})
	})

	test("a Help address with the view closed scopes to the documentation", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: null,
				viewLabel: null,
				pathname: "/docs/getting-around"
			})
		).toEqual({ key: "doc", label: "Documentation", source: "route" })
	})

	// The Help view registers "Documentation" for itself, so an open Help on
	// its own address is the same chip either way — but it is the VIEW's, and
	// its hits are the view's own.
	test("an open view still outranks the docs route", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: "help",
				viewLabel: "Documentation",
				pathname: "/docs/sessions"
			}).source
		).toBe("view")
	})

	// The registered view outranks the route: an admin who opened Characters
	// while standing on an admin page is looking at characters.
	test("the view wins over the admin route", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: "characters",
				viewLabel: "Characters",
				pathname: "/admin/general"
			}).source
		).toBe("view")
	})

	test("anything else is Everywhere", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: null,
				viewLabel: null,
				pathname: "/"
			})
		).toEqual({ key: null, label: EVERYWHERE_LABEL, source: "route" })
	})

	// Session pages are deliberately out of scope this phase.
	test("a session page with no view open is Everywhere", () => {
		expect(
			resolveScope({
				manual: null,
				activeView: null,
				viewLabel: null,
				pathname: "/sessions/42"
			}).key
		).toBeNull()
	})

	test("a manual scope outranks the view and the route alike", () => {
		const chosen = manual("tag", "Tags")
		expect(
			resolveScope({
				manual: chosen,
				activeView: "characters",
				viewLabel: "Characters",
				pathname: "/admin"
			})
		).toBe(chosen)
	})

	// The chip's × — a manual Everywhere, which is NOT the same as no manual
	// scope at all: it has to survive the view underneath it.
	test("a manual Everywhere is not fallen out of", () => {
		expect(
			resolveScope({
				manual: manual(null, EVERYWHERE_LABEL),
				activeView: "characters",
				viewLabel: "Characters",
				pathname: "/"
			})
		).toEqual({ key: null, label: EVERYWHERE_LABEL, source: "manual" })
	})
})

describe("isAdminPath", () => {
	test.each([
		["/admin", true],
		["/admin/users", true],
		["/admin/session-presets", true],
		["/", false],
		["/sessions/1", false],
		// Not every path that starts with those letters is the admin tree.
		["/administrators", false],
		["/adminish", false]
	])("%s → %s", (path, expected) => {
		expect(isAdminPath(path)).toBe(expected)
	})
})

describe("isDocsPath", () => {
	test.each([
		["/docs", true],
		["/docs/getting-around", true],
		["/docs/sdk/laws", true],
		["/", false],
		["/sessions/1", false],
		// Document View is its own surface, with its own inline search and no
		// shell to put a chip in.
		["/document-view/docs", false],
		// Not every path that starts with those letters is the documentation.
		["/docsomething", false]
	])("%s → %s", (path, expected) => {
		expect(isDocsPath(path)).toBe(expected)
	})
})

describe("parseKindPrefix", () => {
	test.each([
		["session:", "session", ""],
		["character:ana", "character", "ana"],
		["lorebook: the north", "lorebook", "the north"],
		["entry:gate", "entry", "gate"],
		["tag:wip", "tag", "wip"],
		["connection:kobold", "connection", "kobold"],
		["user:jody", "user", "jody"],
		["admin:defaults", "admin", "defaults"],
		// A client kind is a scope like any other; only its hits come from
		// this side rather than the wire.
		["doc:swipes", "doc", "swipes"],
		// Case is a typing convenience, not a distinction.
		["Character:ana", "character", "ana"]
	])("%s scopes to %s", (query, key, rest) => {
		expect(parseKindPrefix(query)).toEqual({ key, rest })
	})

	test.each([
		// Not a scope this app has.
		["note: fix later"],
		["http://example.com"],
		// Only at the START — a colon inside a title is a title.
		["the gate: part two"],
		["ana"],
		[""],
		// A bare colon names no kind.
		[":ana"],
		// Not a word boundary we recognise: the prefix is letters only.
		["tag2:wip"],
		// One spelling per scope (R1). "docs:" is not it.
		["docs:swipes"]
	])("%s is searched verbatim", (query) => {
		expect(parseKindPrefix(query)).toBeNull()
	})
})

describe("kindOfScope", () => {
	test("a kind scope answers its kind", () => {
		expect(kindOfScope("character")).toBe("character")
	})

	test.each([
		// A view key is plural; it is never a kind.
		["characters"],
		// Admin is a scope, not a kind — it has no server-side group.
		[ADMIN_SCOPE_KEY],
		// `doc` IS a kind, but a client one: no `jump:search` reply carries a
		// doc group, so treating it as a wire kind would wait for a group that
		// cannot arrive.
		["doc"]
	])("%s is not a kind", (key) => {
		expect(kindOfScope(key)).toBeNull()
	})

	test("Everywhere is not a kind", () => {
		expect(kindOfScope(null)).toBeNull()
	})

	test("admin and doc are still scope keys", () => {
		expect(isKindScopeKey(ADMIN_SCOPE_KEY)).toBe(true)
		expect(isKindScopeKey("doc")).toBe(true)
		expect(isKindScopeKey("characters")).toBe(false)
		expect(isKindScopeKey("docs")).toBe(false)
	})
})

/**
 * The controller, over the one thing that is not a pure function: the query is
 * the SCOPED VIEW's own state, not a copy of it. A copy is what this design
 * exists to avoid — two boxes over one list, the wrong one winning.
 */
describe("createJumpCtx", () => {
	function harness() {
		const shell = { activeView: null as string | null, pathname: "/" }
		const view = { search: "" }
		const ctx = createJumpCtx({
			getActiveView: () => shell.activeView,
			getPathname: () => shell.pathname
		})
		const release = ctx.registerScope("characters", {
			label: "Characters",
			placeholder: "Filter characters",
			getQuery: () => view.search,
			setQuery: (q) => (view.search = q),
			getHits: () => []
		})
		return { shell, view, ctx, release }
	}

	test("a scoped query writes the view's own state, not a copy", () => {
		const { shell, view, ctx } = harness()
		shell.activeView = "characters"
		expect(ctx.scope).toEqual({
			key: "characters",
			label: "Characters",
			source: "view"
		})
		ctx.query = "ana"
		expect(view.search).toBe("ana")
		expect(ctx.query).toBe("ana")
	})

	test("Everywhere keeps its own box, and the view's filter is left alone", () => {
		const { view, ctx } = harness()
		ctx.query = "ana"
		expect(view.search).toBe("")
		expect(ctx.query).toBe("ana")
	})

	test("the placeholder comes from the registration while it is in scope", () => {
		const { shell, ctx } = harness()
		expect(ctx.placeholder).toBe("Jump to anything")
		shell.activeView = "characters"
		expect(ctx.placeholder).toBe("Filter characters")
	})

	test("a manual scope sticks until close, then the view answers again", () => {
		const { shell, ctx } = harness()
		shell.activeView = "characters"
		ctx.open()
		ctx.setScope("tag")
		expect(ctx.scope).toEqual({
			key: "tag",
			label: "Tags",
			source: "manual"
		})
		ctx.close()
		expect(ctx.isOpen).toBe(false)
		expect(ctx.scope.source).toBe("view")
	})

	test("opening clears the shell's box but never a view's filter", () => {
		const { shell, view, ctx } = harness()
		ctx.query = "stale"
		ctx.open()
		expect(ctx.query).toBe("")
		ctx.close()

		shell.activeView = "characters"
		view.search = "ana"
		ctx.open()
		expect(ctx.query).toBe("ana")
	})

	test("unregistering gives the scope back to the route", () => {
		const { shell, ctx, release } = harness()
		shell.activeView = "characters"
		expect(ctx.scope.source).toBe("view")
		release()
		expect(ctx.scope).toEqual({
			key: null,
			label: EVERYWHERE_LABEL,
			source: "route"
		})
	})

	test("widen steps view → route → Everywhere, then stays", () => {
		const { shell, ctx } = harness()
		shell.pathname = "/admin/users"
		shell.activeView = "characters"
		ctx.open()
		expect(ctx.scope.key).toBe("characters")
		ctx.widen()
		expect(ctx.scope).toEqual({
			key: ADMIN_SCOPE_KEY,
			label: ADMIN_SCOPE_LABEL,
			source: "manual"
		})
		ctx.widen()
		expect(ctx.scope).toEqual(manual(null, EVERYWHERE_LABEL))
		ctx.widen()
		expect(ctx.scope).toEqual(manual(null, EVERYWHERE_LABEL))
	})

	test("widen goes straight to Everywhere where the route has no scope", () => {
		const { shell, ctx } = harness()
		shell.activeView = "characters"
		ctx.open()
		ctx.widen()
		expect(ctx.scope).toEqual(manual(null, EVERYWHERE_LABEL))
	})

	test("widen from the route's own scope is Everywhere", () => {
		const { shell, ctx } = harness()
		shell.pathname = "/admin"
		ctx.open()
		expect(ctx.scope.source).toBe("route")
		ctx.widen()
		expect(ctx.scope).toEqual(manual(null, EVERYWHERE_LABEL))
	})

	test("widen from a `kind:` scope steps to the route first", () => {
		const { shell, ctx } = harness()
		shell.pathname = "/docs/sessions"
		ctx.open()
		ctx.setScope("tag")
		ctx.widen()
		expect(ctx.scope.key).toBe("doc")
		ctx.widen()
		expect(ctx.scope.key).toBe(null)
	})
})
