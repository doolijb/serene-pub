/**
 * The one avatar and its scale (notes 36, 2026-10-02; STYLE-GUIDE §6.4), and
 * the Sessions view's card (notes 36) and toolbar pieces (notes 25), rendered.
 *
 * `render` from `svelte/server`, like the connections index tests: what these
 * pin IS the markup — which step, which shape, which fallback, which button
 * class — not layout.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"
import { createRawSnippet } from "svelte"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

import Avatar from "./Avatar.svelte"
import { AVATAR_PX, avatarInitial } from "./avatar"
import AvatarStack from "./AvatarStack.svelte"
import SessionCardItem from "./listItems/SessionCardItem.svelte"
import ViewToolbar from "./panels/ViewToolbar.svelte"
import ListCardToggle from "./panels/ListCardToggle.svelte"
import { toolbarButtonClass } from "./panels/toolbarButton"
import SpAvatar from "./hostElements/SpAvatar.svelte"
import { hostElementContext } from "./hostElements/context.svelte"

describe("Avatar", () => {
	test("the scale is fixed pixels", () => {
		expect(AVATAR_PX).toEqual({ xs: 24, sm: 32, md: 40, lg: 56, xl: 72 })
	})

	test("a step draws its size and shape", () => {
		const html = render(Avatar, {
			props: { src: "/a.png", size: "md", shape: "square", decorative: true }
		}).body
		expect(html).toContain('data-avatar="md"')
		expect(html).toContain('data-avatar-shape="square"')
		expect(html).toContain("size-10")
		expect(html).toContain("rounded-[9px]")
		expect(html).toContain('alt=""')
	})

	test("no picture: the persona glyph for a persona, the initial on request", () => {
		const persona = render(Avatar, {
			props: { char: { name: "Ash", isPersona: true } as any, size: "sm" }
		}).body
		expect(persona).toContain('data-avatar-fallback="glyph"')
		expect(persona).toContain('aria-label="Ash"')
		const initial = render(Avatar, {
			props: { name: "bramble", fallback: "initial", size: "sm" }
		}).body
		expect(initial).toContain('data-avatar-fallback="initial"')
		expect(initial).toContain(">B<")
	})

	test("the persona mark is drawn only for a persona", () => {
		const mark = (isPersona: boolean) =>
			render(Avatar, {
				props: {
					char: { name: "Ash", isPersona } as any,
					size: "lg",
					personaMark: true
				}
			}).body.includes("data-avatar-persona")
		expect(mark(true)).toBe(true)
		expect(mark(false)).toBe(false)
	})

	test("no size is the list row's step, md, with its guards", () => {
		const html = render(Avatar, { props: {} }).body
		expect(html).toContain('data-avatar="md"')
		expect(html).toContain("min-w-10")
	})

	test("avatarInitial", () => {
		expect(avatarInitial("  wren")).toBe("W")
		expect(avatarInitial("")).toBe("?")
	})
})

describe("sp-avatar", () => {
	const draw = (size: string | null, avatarUrl: string | null) => {
		hostElementContext.participant = () => ({ name: "wren", avatarUrl })
		return render(SpAvatar, {
			props: { attrs: { ref: "character:1", size }, writes: {} } as any
		}).body
	}

	test("sm · md · lg are the scale's xs · sm · lg, round", () => {
		expect(draw("sm", null)).toContain('data-avatar-px="24"')
		expect(draw("md", null)).toContain('data-avatar-px="32"')
		expect(draw(null, null)).toContain('data-avatar-px="32"')
		expect(draw("lg", null)).toContain('data-avatar-px="56"')
		expect(draw("md", null)).toContain("rounded-full")
	})

	test("a picture is cropped from the top; none is the initial", () => {
		expect(draw("md", "/a.png")).toContain("object-position:top")
		const html = draw("md", null)
		expect(html).toContain("sp-avatar-fallback")
		expect(html).toMatch(/>\s*W\s*</)
		hostElementContext.participant = undefined
	})
})

describe("AvatarStack", () => {
	test("up to max faces, then a spoken count", () => {
		const members = ["A", "B", "C", "D"].map((name, id) => ({ id, name }))
		const html = render(AvatarStack, {
			props: { members: members as any, size: "md", max: 3 }
		}).body
		expect(html.match(/data-avatar="md"/g)?.length).toBe(3)
		expect(html).toContain("and 1 more")
	})
})

describe("SessionCardItem", () => {
	const session = {
		id: 4,
		name: "The lighthouse",
		genreName: "Adventure",
		canEdit: true,
		isOwner: true,
		sessionCharacters: [
			{ character: { id: 1, name: "Wren" } },
			{ character: { id: 2, name: "Ash" } }
		],
		lastMessage: {
			isUser: false,
			speakerName: "Wren",
			excerpt: "The lamp is lit."
		}
	} as any

	test("names the session, its genre, whose turn and the last line", () => {
		const html = render(SessionCardItem, {
			props: { session, showGenre: true }
		}).body
		expect(html).toContain("The lighthouse")
		expect(html).toContain("Adventure")
		expect(html).toContain("Your turn")
		expect(html).toContain("The lamp is lit.")
		// A group's faces stand on the cover.
		expect(html).toContain("data-avatar-stack")
	})
})

describe("view toolbar", () => {
	test("icon buttons are never bare: tonal surface at rest, tonal primary on", () => {
		expect(toolbarButtonClass()).toContain("preset-tonal-surface")
		expect(toolbarButtonClass(true)).toContain("preset-tonal-primary")
		expect(toolbarButtonClass(true)).not.toContain("preset-filled")
	})

	test("rows render in order and empty rows are not drawn", () => {
		const primary = createRawSnippet(() => ({
			render: () => "<button>New</button>"
		}))
		const filter = createRawSnippet(() => ({
			render: () => "<input aria-label='Filter' />"
		}))
		const html = render(ViewToolbar, {
			props: { label: "Sessions", primary, filter }
		}).body
		expect(html).toContain("data-view-toolbar-actions")
		expect(html).toContain("data-view-toolbar-find")
		expect(html).not.toContain("data-view-toolbar-chips")
		expect(html.indexOf("New")).toBeLessThan(html.indexOf("Filter"))
	})

	test("the list/card pair marks the chosen mode pressed", () => {
		const html = render(ListCardToggle, {
			props: { mode: { value: "cards" }, label: "Sessions" }
		}).body
		expect(html).toMatch(/aria-label="Card view"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Card view"/)
	})
})
