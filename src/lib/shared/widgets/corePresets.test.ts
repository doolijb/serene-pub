import { describe, expect, test } from "vitest"
import {
	COMPOSER_STYLE_PRESETS,
	MESSAGE_STYLE_PRESETS,
	legacyLayoutAttr,
	legacyPackPin,
	withCorePresets
} from "./corePresets"
import { systemStyleSlug, type WidgetDecl } from "./types"
import type { ResolvableStyle } from "./resolve"
import { resolveStyle } from "./resolve"

const row = (id: number, widgetSlug: string, slug: string): ResolvableStyle => ({
	id,
	slug,
	widgetSlug
})

/** The rows a seeded instance holds for the two primary widgets. */
const seeded: ResolvableStyle[] = [
	...MESSAGE_STYLE_PRESETS.map((p, i) =>
		row(10 + i, "messages", systemStyleSlug("messages", p.slug))
	),
	...COMPOSER_STYLE_PRESETS.map((p, i) =>
		row(20 + i, "composer", systemStyleSlug("composer", p.slug))
	),
	row(99, "messages", "user:1:messages:abc123")
]

describe("withCorePresets", () => {
	const decls: WidgetDecl[] = [
		{
			id: "messages",
			title: "Messages",
			surface: { kind: "native", component: "messages" },
			presets: [{ slug: "default", title: "Default", css: "" }]
		},
		{
			id: "composer",
			title: "Composer",
			surface: { kind: "native", component: "composer" },
			presets: [{ slug: "default", title: "Default", css: "" }]
		},
		{
			id: "scene-portraits",
			title: "Scene Portraits",
			surface: { kind: "native", component: "scene-portraits" },
			presets: [{ slug: "default", title: "Default", css: "" }]
		}
	]

	test("attaches the eight packs to messages + composer", () => {
		const out = withCorePresets(decls)
		expect(out.find((d) => d.id === "messages")?.presets?.map((p) => p.slug))
			.toEqual(["default", "bubbles", "novel", "compact", "cameo"])
		expect(out.find((d) => d.id === "composer")?.presets?.map((p) => p.slug))
			.toEqual(["default", "minimal", "writer"])
	})

	test("REPLACES the SDK's bare default rather than adding beside it", () => {
		// Two rows on one slug is a unique-index fight between the reconciler
		// and itself; the packs' own default IS the default slot.
		const messages = withCorePresets(decls).find((d) => d.id === "messages")
		const defaults = messages!.presets!.filter((p) => p.slug === "default")
		expect(defaults).toHaveLength(1)
		expect(defaults[0].title).toBe("Clean")
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
		for (const p of [...MESSAGE_STYLE_PRESETS, ...COMPOSER_STYLE_PRESETS]) {
			expect(p.css).not.toContain("data-msg-layout")
			expect(p.css).not.toContain("data-composer-layout")
			expect(p.css).not.toContain(".chat-core")
			// The mode lives on <html>; a scoped skin can never select it.
			expect(p.css).not.toContain("data-mode")
		}
	})
})

describe("legacyPackPin — the pre-style-system choice, derived", () => {
	test("a saved pack id resolves to its system row", () => {
		const pin = legacyPackPin("messages", { chat: "bubbles" }, seeded)
		expect(pin?.slug).toBe(systemStyleSlug("messages", "bubbles"))
		expect(pin?.id).toBe(seeded.find((r) => r.slug === pin!.slug)!.id)
	})

	test("clean and classic map to the `default` slot they now fill", () => {
		expect(legacyPackPin("messages", { chat: "clean" }, seeded)?.slug).toBe(
			systemStyleSlug("messages", "default")
		)
		expect(
			legacyPackPin("composer", { composer: "classic" }, seeded)?.slug
		).toBe(systemStyleSlug("composer", "default"))
	})

	test("each widget reads only its OWN slot", () => {
		// A composer choice must never become the messages widget's pin.
		expect(
			legacyPackPin("messages", { composer: "minimal" }, seeded)
		).toBeUndefined()
		expect(
			legacyPackPin("composer", { chat: "bubbles" }, seeded)
		).toBeUndefined()
		expect(legacyPackPin("composer", { composer: "writer" }, seeded)?.slug)
			.toBe(systemStyleSlug("composer", "writer"))
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
		expect(
			legacyLayoutAttr("composer", systemStyleSlug("composer", "default"))
		).toBe("classic")
		expect(
			legacyLayoutAttr("composer", systemStyleSlug("composer", "minimal"))
		).toBe("minimal")
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
			legacyLayoutAttr("messages", systemStyleSlug("composer", "minimal"))
		).toBeUndefined()
	})
})
