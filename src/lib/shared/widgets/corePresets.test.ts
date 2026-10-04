import { describe, expect, test } from "vitest"
import {
	MESSAGE_STYLE_PRESETS,
	legacyLayoutAttr,
	legacyPackPin,
	withCorePresets,
	type LegacyStylePacks
} from "./corePresets"
import { systemStyleSlug, type WidgetDecl } from "./types"
import type { ResolvableStyle } from "./resolve"
import { resolveStyle } from "./resolve"

const row = (id: number, widgetSlug: string, slug: string): ResolvableStyle => ({
	id,
	slug,
	widgetSlug
})

/** The rows a seeded instance holds for the primary widget and one beside it. */
const seeded: ResolvableStyle[] = [
	...MESSAGE_STYLE_PRESETS.map((p, i) =>
		row(10 + i, "messages", systemStyleSlug("messages", p.slug))
	),
	row(20, "stats", systemStyleSlug("stats", "default")),
	row(99, "messages", "user:1:messages:abc123")
]

describe("withCorePresets", () => {
	const decls: WidgetDecl[] = [
		{
			id: "messages",
			title: "Messages",
			component: "messages",
			presets: [{ slug: "default", title: "Default", css: "" }]
		},
		{
			id: "scene-portraits",
			title: "Scene Portraits",
			component: "scene-portraits",
			presets: [{ slug: "default", title: "Default", css: "" }]
		}
	]

	test("attaches the five packs to messages", () => {
		const out = withCorePresets(decls)
		expect(out.find((d) => d.id === "messages")?.presets?.map((p) => p.slug))
			.toEqual(["default", "bubbles", "novel", "compact", "cameo"])
	})

	test("the composer is a setting on messages, never a widget beside it", () => {
		// The packs the app contributes are the MESSAGE looks and nothing else:
		// how the field is drawn is `settings.composer` on this same widget, so
		// a style row for a `composer` widget would have nothing to skin.
		expect(withCorePresets(decls).some((d) => d.id === "composer")).toBe(
			false
		)
	})

	test("REPLACES the SDK's bare default rather than adding beside it", () => {
		// Two rows on one slug is a unique-index fight between the reconciler
		// and itself; the packs' own default IS the default slot, and Stage is
		// what fills it.
		const messages = withCorePresets(decls).find((d) => d.id === "messages")
		const defaults = messages!.presets!.filter((p) => p.slug === "default")
		expect(defaults).toHaveLength(1)
		expect(defaults[0].title).toBe("Stage")
	})

	test("every pack is titled, and the titles are the ones the picker shows", () => {
		expect(MESSAGE_STYLE_PRESETS.map((p) => p.title)).toEqual([
			"Stage",
			"Bubbles",
			"Novel",
			"Compact",
			"Dreamlit Cameo"
		])
	})

	test("leaves a widget the app ships no packs for untouched", () => {
		const out = withCorePresets(decls)
		expect(
			out.find((d) => d.id === "scene-portraits")?.presets?.map((p) => p.slug)
		).toEqual(["default"])
	})

	test("does not mutate the decls it is given", () => {
		const before = JSON.stringify(decls)
		withCorePresets(decls)
		expect(JSON.stringify(decls)).toBe(before)
	})

	test("every pack's CSS is scope-ready — no [data-msg-layout] guards, no ancestor mode selector", () => {
		for (const p of MESSAGE_STYLE_PRESETS) {
			expect(p.css).not.toContain("data-msg-layout")
			expect(p.css).not.toContain(".chat-core")
			// The mode lives on <html>; a scoped skin can never select it, so
			// anything that differs by mode is a `light-dark()` pair instead.
			expect(p.css).not.toContain("data-mode")
		}
	})

	test("every pack selects the message's widget parts, never a class", () => {
		// The markup carries parts, never looks (P3h): a pack names the root
		// (`messages.root`, where its palette lives) and the four cells and the
		// row by their `data-widget-part` tokens; the classes they replaced are
		// gone from the markup, so a rule on one would draw nothing.
		for (const p of MESSAGE_STYLE_PRESETS) {
			expect(p.css).toContain('[data-widget-part~="messages.root"] {')
			expect(p.css).toContain('[data-widget-part~="messages.message"]')
			expect(p.css).not.toMatch(/\.sp-(conversation|msg|column|log)\b/)
		}
	})

	test("no pack styles the composer — how the field is drawn is a setting", () => {
		for (const p of MESSAGE_STYLE_PRESETS) {
			// The compose block, its area and every composer part (P3g):
			// `messages.compose`, `messages.compose-area`, `messages.composer-*`.
			expect(p.css).not.toContain("messages.compose")
		}
	})

	test("no pack restyles a shared message state — those are one treatment", () => {
		// A pack may GUARD a look on the normal state (Stage's hover does), but
		// selected / dim / editing / hidden belong to messageLayouts.css so they
		// read the same whichever pack is on.
		for (const p of MESSAGE_STYLE_PRESETS) {
			for (const state of ["selected", "dim", "editing"]) {
				expect(p.css).not.toContain(`data-msg-state="${state}"`)
			}
			expect(p.css).not.toContain("data-msg-hidden")
		}
	})

	test("story prose is set in two tones, in the face the guide names", () => {
		// STYLE-GUIDE §3.3: dialogue and narration are different colours, and
		// the prose face is Literata via `--sp-prose`. Bubbles and Compact are
		// the two that are deliberately Sans.
		for (const p of MESSAGE_STYLE_PRESETS) {
			expect(p.css).toContain("--sp-body:")
			expect(p.css).toContain("--sp-quote:")
		}
		for (const slug of ["default", "novel", "cameo"]) {
			const pack = MESSAGE_STYLE_PRESETS.find((p) => p.slug === slug)!
			expect(pack.css).toContain("var(--sp-prose)")
		}
	})

	test("anything that differs by mode is a light/dark pair", () => {
		// The surface ladder is ONE ladder — `--color-surface-950` is night
		// indigo under a light theme too — so a bare dark stop on a ground or a
		// text tone is a bug even though it looks right today.
		for (const p of MESSAGE_STYLE_PRESETS) {
			expect(p.css).toContain("light-dark(")
		}
	})
})

describe("legacyPackPin — the pre-style-system choice, derived", () => {
	test("a saved pack id resolves to its system row", () => {
		const pin = legacyPackPin("messages", { chat: "bubbles" }, seeded)
		expect(pin?.slug).toBe(systemStyleSlug("messages", "bubbles"))
		expect(pin?.id).toBe(seeded.find((r) => r.slug === pin!.slug)!.id)
	})

	test("clean maps to the `default` slot it now fills", () => {
		expect(legacyPackPin("messages", { chat: "clean" }, seeded)?.slug).toBe(
			systemStyleSlug("messages", "default")
		)
	})

	test("messages is the only widget with a slot to read", () => {
		// The blob's other slot named a composer look, which is a setting on
		// the messages widget rather than a style row — there is nothing for a
		// pin to point at, and it must never become the messages widget's pin.
		const olderBlob: LegacyStylePacks & { composer?: string } = {
			composer: "minimal"
		}
		expect(legacyPackPin("messages", olderBlob, seeded)).toBeUndefined()
		expect(
			legacyPackPin("composer", { chat: "bubbles" }, seeded)
		).toBeUndefined()
		expect(
			legacyPackPin("stats", { chat: "bubbles" }, seeded)
		).toBeUndefined()
	})

	test("no choice, an unknown pack, or another widget → no pin", () => {
		expect(legacyPackPin("messages", null, seeded)).toBeUndefined()
		expect(legacyPackPin("messages", {}, seeded)).toBeUndefined()
		expect(
			legacyPackPin("messages", { chat: "moonlit" }, seeded)
		).toBeUndefined()
		expect(
			legacyPackPin("scene-portraits", { chat: "bubbles" }, seeded)
		).toBeUndefined()
	})

	test("a pack whose row is not seeded yet → no pin (the list hasn't landed)", () => {
		expect(legacyPackPin("messages", { chat: "cameo" }, [])).toBeUndefined()
	})

	test("the derived pin feeds resolveStyle, and an unresolvable one degrades to the default", () => {
		const chosen = resolveStyle(
			"messages",
			legacyPackPin("messages", { chat: "novel" }, seeded),
			seeded
		)
		expect(chosen?.slug).toBe(systemStyleSlug("messages", "novel"))
		const gone = resolveStyle(
			"messages",
			legacyPackPin("messages", { chat: "moonlit" }, seeded),
			seeded
		)
		expect(gone?.slug).toBe(systemStyleSlug("messages", "default"))
	})

	test("a real pin wins: the fallback is only consulted when there is none", () => {
		// The caller's rule (`pins[id] ?? legacyPackPin(...)`) is what makes the
		// first pick from the overlay end the migration; this pins the contract
		// the caller relies on — the legacy answer is a plain value, not a write.
		const pin = { id: 99, slug: "user:1:messages:abc123" }
		expect(resolveStyle("messages", pin, seeded)?.id).toBe(99)
	})
})

describe("legacyLayoutAttr — the transitional data-*-layout value", () => {
	test("a shipped preset answers with its legacy pack name", () => {
		expect(
			legacyLayoutAttr("messages", systemStyleSlug("messages", "default"))
		).toBe("clean")
		expect(
			legacyLayoutAttr("messages", systemStyleSlug("messages", "cameo"))
		).toBe("cameo")
	})

	test("a widget with no bridge answers with the preset slug it was given", () => {
		// `default` has no legacy name outside messages, so the slug stands.
		expect(
			legacyLayoutAttr("stats", systemStyleSlug("stats", "default"))
		).toBe("default")
	})

	test("a user's own style writes no pack attribute — no pack is active", () => {
		expect(
			legacyLayoutAttr("messages", "user:1:messages:abc123")
		).toBeUndefined()
		expect(legacyLayoutAttr("messages", undefined)).toBeUndefined()
		expect(legacyLayoutAttr("messages", null)).toBeUndefined()
	})

	test("a preset with no legacy name answers with its preset slug", () => {
		expect(
			legacyLayoutAttr("messages", systemStyleSlug("messages", "future"))
		).toBe("future")
	})

	test("another widget's slug is not this widget's attribute", () => {
		expect(
			legacyLayoutAttr("messages", systemStyleSlug("stats", "default"))
		).toBeUndefined()
	})
})

describe("folded sections in every pack (B4)", () => {
	// A reply's Plan and Reasoning fold in the one SessionMessage every pack
	// skins; a pack owns the LOOK, never whether a fold is there. So no pack
	// may reach the fold chrome — its button, its track or its list.
	test.each(MESSAGE_STYLE_PRESETS.map((p) => [p.slug, p.css] as const))(
		"%s leaves the folds to the base sheet",
		(_slug, css) => {
			expect(css).not.toMatch(
				/messages\.(message-disclosure|part-disclosure|fold-list)/
			)
		}
	)
})
