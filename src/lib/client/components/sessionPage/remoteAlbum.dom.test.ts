/**
 * Core's remote Album widget (PLAN-core-widgets W2) — the built module
 * (`@serene-pub/core-catalog/components/album.js`) mounted through the SDK's
 * component harness in core's box, posted what the page posts it: the log
 * (`messages.v1`, each row's parts), its settings, the viewer, and only the
 * base sections its declaration reads.
 *
 * Its press is the media strip's: `view-image` with the whole album as the
 * lightbox's pages, which the page's own answer (`answerViewImage`) takes
 * as it takes the strip's. Its caption is no link to the line: a fragment
 * from any box but the conversation holding the page's ids is prefixed into
 * that box, so `#message-<id>` cannot reach the log's anchor.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { MessagePartV1, MessageV1, ViewerV1 } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { answerViewImage, type ViewImageGallery } from "./requests/viewImage"

const require = createRequire(import.meta.url)
const BUILT = require.resolve("@serene-pub/core-catalog/components/album.js")
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/album\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "album")!

/* ── one session's log, oldest first, as the page holds it ─────────────── */

let nextPart = 1
const image = (
	messageId: number,
	assetId: number,
	data: Record<string, unknown> = {}
): MessagePartV1 => ({
	id: nextPart++,
	messageId,
	step: 0,
	revision: 0,
	ordinal: 0,
	type: "core:image",
	content: null,
	data: { assetId, ...data }
})

const row = (
	id: number,
	role: string,
	speakerLabel: string,
	parts: MessagePartV1[],
	over: Partial<MessageV1> = {}
): MessageV1 => ({
	id,
	role,
	content: "",
	speakerLabel,
	createdAt: "2026-10-11T21:41:00Z",
	parts,
	...over
})

const LOG: MessageV1[] = [
	row(1, "user", "Mara", [image(1, 11, { alt: "the map" })]),
	row(2, "assistant", "Wren", [
		image(2, 21, { filename: "forest.png" }),
		{ ...image(2, 22), ordinal: 1 }
	]),
	row(3, "user", "Mara", [], { content: "No pictures here." }),
	row(4, "assistant", "Castellan", [image(4, 41)], { channel: "sanctum" })
]

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }

/* ── the remote, as the page mounts it ─────────────────────────────────── */

const views: MountedComponent[] = []
/** What the page's lightbox was asked to show, through the page's own answer. */
const shown: Array<{ src: string; gallery?: ViewImageGallery }> = []

async function mountAlbum(
	o: { messages?: MessageV1[]; settings?: Record<string, unknown> } = {}
) {
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Undercroft" },
			settings: o.settings ?? {},
			viewer: OWNER,
			messages: o.messages ?? LOG
		},
		requests: (kind, params) => {
			if (kind === "view-image")
				return answerViewImage(
					params,
					{ owner: "core" },
					{
						viewImage: (src, gallery) =>
							shown.push({ src, gallery })
					}
				)
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

const part = (name: string) => `[data-widget-part~="album.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const srcs = (view: MountedComponent, within: string) =>
	view
		.queryAll(`${part(within)} ${part("tile")} img`)
		.map((i) => i.getAttribute("src"))

describe("core's remote Album", () => {
	test(
		"every picture on the lines, newest line first, each with its origin glyph and caption",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAlbum()
			expect(view.refused).toEqual([])
			expect(view.errors).toEqual([])
			const root = view.query(part("root"))!
			expect(root.getAttribute("data-arrangement")).toBe("grid")
			expect(root.getAttribute("data-tile")).toBe("medium")
			expect(text(view.query(part("toolbar")))).toBe("4 pictures")

			expect(srcs(view, "grid")).toEqual([
				"/media/41?v=thumb",
				"/media/21?v=thumb",
				"/media/22?v=thumb",
				"/media/11?v=thumb"
			])
			const tiles = view.queryAll(part("tile"))
			expect(tiles.map((t) => t.getAttribute("data-origin"))).toEqual([
				"generated",
				"generated",
				"generated",
				"attached"
			])
			expect(
				view
					.queryAll(`${part("origin")} sp-icon`)
					.map((i) => i.getAttribute("name"))
			).toEqual(["sparkles", "sparkles", "sparkles", "paperclip"])
			const map = tiles[3]!
			const caption = text(map.querySelector(part("caption")))!
			expect(caption).toMatch(/^Mara · \S/)
			expect(map.getAttribute("aria-label")).toBe(
				`Open attached image the map, ${caption}, 4 of 4`
			)
		}
	)

	test(
		"a press opens the lightbox on that picture, the whole album its pages in the order drawn",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAlbum()
			shown.length = 0
			await view.click(view.queryAll(part("tile"))[2]!)
			expect(view.requested).toEqual([
				{
					kind: "view-image",
					params: {
						src: "/media/22",
						gallery: {
							srcs: [
								"/media/41",
								"/media/21",
								"/media/22",
								"/media/11"
							],
							index: 2,
							captions: [
								"Image",
								"forest.png",
								"Image",
								"the map"
							]
						}
					}
				}
			])
			// The page's own answer took it, as it takes the media strip's.
			expect(shown).toEqual([
				{
					src: "/media/22",
					gallery: expect.objectContaining({ index: 2 })
				}
			])
			expect(view.query(part("alert"))).toBeNull()
		}
	)

	test(
		"a file that is gone is said so and leaves the lightbox's pages",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAlbum()
			await view.dispatch(
				view.queryAll(`${part("tile")} img`)[1]!,
				"error"
			)
			const gone = view.query(`${part("tile")}[data-missing]`)
			expect(text(gone)).toBe("File no longer available")
			await view.click(view.queryAll(`button${part("tile")}`)[2]!)
			const params = view.requested.at(-1)!.params as {
				src: string
				gallery: { srcs: string[]; index: number }
			}
			expect(params.gallery.srcs).toEqual([
				"/media/41",
				"/media/22",
				"/media/11"
			])
			expect(params.src).toBe("/media/11")
			expect(params.gallery.index).toBe(2)
		}
	)

	test(
		"Newest large: the newest whole, the rest a strip; tile sets the side",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAlbum({
				settings: { arrangement: "latest", tile: "small" }
			})
			const root = view.query(part("root"))!
			expect(root.getAttribute("data-arrangement")).toBe("latest")
			expect(root.getAttribute("data-tile")).toBe("small")
			expect(view.query(part("grid"))).toBeNull()
			expect(srcs(view, "latest")).toEqual(["/media/41?v=fitted"])
			expect(srcs(view, "strip")).toEqual([
				"/media/21?v=thumb",
				"/media/22?v=thumb",
				"/media/11?v=thumb"
			])
			// The lead is page one of the same album.
			await view.click(`${part("latest")} ${part("tile")}`)
			expect(view.requested.at(-1)!.params).toMatchObject({
				src: "/media/41",
				gallery: { index: 0 }
			})
		}
	)

	test(
		"source and channel narrow it; empty says so in one line",
		{ timeout: 120_000 },
		async () => {
			const attached = await mountAlbum({
				settings: { source: "attached" }
			})
			expect(srcs(attached, "grid")).toEqual(["/media/11?v=thumb"])
			expect(text(attached.query(part("toolbar")))).toBe("1 picture")

			const sanctum = await mountAlbum({
				settings: { channel: "sanctum" }
			})
			expect(srcs(sanctum, "grid")).toEqual(["/media/41?v=thumb"])

			const empty = await mountAlbum({ messages: [LOG[2]!] })
			expect(text(empty.query(part("empty")))).toBe(
				"Nothing has been attached or generated in this session yet."
			)
			expect(empty.query(part("toolbar"))).toBeNull()
			expect(empty.query(part("grid"))).toBeNull()

			// A new line's picture arrives with the log, first.
			await empty.push("messages", [
				...LOG.slice(0, 3),
				row(5, "assistant", "Wren", [image(5, 51)])
			])
			expect(srcs(empty, "grid")[0]).toBe("/media/51?v=thumb")
		}
	)

	test(
		"the caption is no link to its line: this box's fragments are its own",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAlbum()
			// The page anchors a line as `#message-<id>`, unprefixed, in the
			// conversation that holds the page's ids; this box prefixes every
			// fragment it writes (`guardedConnection`), so the link could not
			// land there. The album draws none.
			expect(view.idPrefix).not.toBe("")
			expect(view.queryAll("a")).toEqual([])
		}
	)
})
