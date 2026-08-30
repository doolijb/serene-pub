import { describe, expect, test } from "vitest"
import { defaultStyleFor, resolveStyle, type ResolvableStyle } from "./resolve"
import { systemStyleSlug } from "./types"

const row = (
	id: number,
	widgetSlug: string,
	slug: string
): ResolvableStyle => ({ id, slug, widgetSlug })

describe("resolveStyle", () => {
	const candidates: ResolvableStyle[] = [
		row(1, "messages", systemStyleSlug("messages", "default")),
		row(2, "messages", systemStyleSlug("messages", "compact")),
		row(7, "messages", "user-my-skin"),
		row(9, "composer", systemStyleSlug("composer", "default"))
	]

	test("exact id+slug match wins", () => {
		const r = resolveStyle("messages", { id: 2, slug: systemStyleSlug("messages", "compact") }, candidates)
		expect(r?.id).toBe(2)
	})

	test("id alone resolves when the slug drifted (renamed row)", () => {
		const r = resolveStyle("messages", { id: 7, slug: "user-old-name" }, candidates)
		expect(r?.id).toBe(7)
	})

	test("slug alone resolves when a reseed renumbered the row", () => {
		const r = resolveStyle(
			"messages",
			{ id: 999, slug: systemStyleSlug("messages", "compact") },
			candidates
		)
		expect(r?.id).toBe(2)
	})

	test("neither id nor slug reconciles → the widget default", () => {
		const r = resolveStyle("messages", { id: 999, slug: "gone" }, candidates)
		expect(r?.slug).toBe(systemStyleSlug("messages", "default"))
	})

	test("a pin to another user's now-invisible style falls back to default, not the wrong widget", () => {
		// The candidate set is the caller's usable rows; a private style simply
		// isn't in it, so it degrades to THIS widget's default.
		const r = resolveStyle("composer", { id: 7, slug: "user-my-skin" }, candidates)
		expect(r?.slug).toBe(systemStyleSlug("composer", "default"))
	})

	test("no ref → the widget default", () => {
		expect(resolveStyle("messages", undefined, candidates)?.slug).toBe(
			systemStyleSlug("messages", "default")
		)
	})

	test("a widget with no usable style at all resolves to undefined", () => {
		expect(resolveStyle("unknown", undefined, candidates)).toBeUndefined()
	})
})

describe("defaultStyleFor", () => {
	test("prefers the <widget>:default slug", () => {
		const cands = [
			row(2, "messages", systemStyleSlug("messages", "compact")),
			row(1, "messages", systemStyleSlug("messages", "default"))
		]
		expect(defaultStyleFor("messages", cands)?.id).toBe(1)
	})

	test("falls back to the first row for the widget when no :default exists", () => {
		const cands = [row(2, "messages", systemStyleSlug("messages", "compact"))]
		expect(defaultStyleFor("messages", cands)?.id).toBe(2)
	})
})
