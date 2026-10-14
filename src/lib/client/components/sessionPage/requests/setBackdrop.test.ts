/**
 * 🚧 The Backdrop widget (DESIGN-image-generation §6.4): its declaration's
 * settings as the page resolves them, its plain half, and the page's answer
 * to `set-backdrop`.
 */
import { describe, expect, test } from "vitest"
import { CORE_WIDGETS } from "@serene-pub/core-catalog/core-widgets"
import {
	BACKDROP_EMPTY,
	backdropOf,
	mayChangeBackdrop,
	readBackdropSettings
} from "@serene-pub/core-catalog/backdrop"
import { WIDGET_REQUEST_ASKERS, widgetRequestRefusal } from "@serene-pub/sdk"
import {
	effectiveWidgetSettings,
	pruneWidgetSettings,
	widgetSettingsSchema,
	type WidgetSettingsDecl
} from "$lib/shared/widgets/settings"
import { answerSetBackdrop, backdropReplyKey } from "./setBackdrop"
import { answerSessionImages } from "./sessionImages"
import { buildWidgetRequestAnswerer, type WidgetRequestDeps } from "./index"

// The page reads a core declaration's settings as `WidgetSettingsDecl`
// (its title already resolved); the fields under test are the same.
const decl = CORE_WIDGETS.find((w) => w.id === "backdrop")! as unknown as WidgetSettingsDecl

describe("the Backdrop widget's declaration", () => {
	test("is core's, reads the session, and holds the cast for its chooser", () => {
		expect(decl).toMatchObject({ title: "Backdrop", icon: "MountainSnow", component: "backdrop" })
		expect(decl).toMatchObject({ reads: ["session", "settings", "locale", "viewer", "actions"] })
		expect(decl).toMatchObject({ scopes: ["characters"] })
	})

	test("its settings register: fit cover|contain, dim 0..100, with defaults", () => {
		const schema = widgetSettingsSchema(decl)
		expect(schema.fit).toMatchObject({ type: "enum", of: ["cover", "contain"], default: "cover" })
		expect(schema.dim).toMatchObject({ type: "integer", min: 0, max: 100, default: 0 })
		expect(effectiveWidgetSettings({ decl })).toMatchObject({ fit: "cover", dim: 0 })
		expect(effectiveWidgetSettings({ decl, stored: { fit: "contain", dim: 40 } })).toMatchObject({
			fit: "contain",
			dim: 40
		})
		// A value the declaration refuses does not survive the prune.
		expect(pruneWidgetSettings(schema, { fit: "stretch" }).values.fit).toBeUndefined()
	})
})

describe("the plain half", () => {
	test("reads settings whole, clamping dim", () => {
		expect(readBackdropSettings(undefined)).toEqual({ fit: "cover", dim: 0 })
		expect(readBackdropSettings({ fit: "contain", dim: 250 })).toEqual({ fit: "contain", dim: 100 })
		expect(readBackdropSettings({ fit: "nope", dim: -3 })).toEqual({ fit: "cover", dim: 0 })
	})

	test("reads the backdrop off the session section, absent as null", () => {
		expect(backdropOf(undefined)).toBeNull()
		expect(backdropOf({ id: 1, name: null })).toBeNull()
		expect(backdropOf({ id: 1, name: null, backdrop: null })).toBeNull()
		expect(
			backdropOf({ id: 1, name: null, backdrop: { mediaId: 9, src: "/media/9?v=fitted" } })
		).toEqual({ mediaId: 9, src: "/media/9?v=fitted" })
		expect(BACKDROP_EMPTY).toBe("No backdrop yet — Scene will set one, or pick an image")
	})

	test("offers Change and Clear to the owner or an admin, never a guest", () => {
		expect(mayChangeBackdrop({ userId: 1, isAdmin: false, isGuest: false })).toBe(true)
		expect(mayChangeBackdrop({ userId: 2, isAdmin: false, isGuest: true })).toBe(false)
		expect(mayChangeBackdrop({ userId: 3, isAdmin: true, isGuest: true })).toBe(true)
		expect(mayChangeBackdrop({ userId: null, isAdmin: false, isGuest: false })).toBe(false)
	})
})

describe("set-backdrop", () => {
	test("is core's alone to ask", () => {
		expect(WIDGET_REQUEST_ASKERS["set-backdrop"]).toBe("core")
		expect(widgetRequestRefusal("set-backdrop", { owner: "core" })).toBeNull()
		expect(widgetRequestRefusal("set-backdrop", { owner: "acme.rp", grants: ["characters"] })).toMatch(/./)
	})

	test("sends the page's session and the ref, and a refusal is the request's", async () => {
		const asked: unknown[] = []
		const write = async (ask: { sessionId: number; mediaRef: string | null }) => {
			asked.push(ask)
			return ask.mediaRef === "nope"
				? { sessionId: ask.sessionId, error: "Only the session's owner can change its backdrop." }
				: { sessionId: ask.sessionId, backdropMediaId: 4 }
		}
		await answerSetBackdrop({ mediaRef: " abc " }, 7, write)
		await answerSetBackdrop({ mediaRef: null }, 7, write)
		expect(asked).toEqual([
			{ sessionId: 7, mediaRef: "abc" },
			{ sessionId: 7, mediaRef: null }
		])
		await expect(answerSetBackdrop({ mediaRef: "nope" }, 7, write)).rejects.toThrow(/owner/)
		await expect(answerSetBackdrop({ mediaRef: 3 }, 7, write)).rejects.toThrow(/ref/)
		await expect(answerSetBackdrop({ mediaRef: "abc" }, null, write)).rejects.toThrow(/no session/)
		expect(backdropReplyKey({ sessionId: 7, request: "r1" })).toBe("r1")
	})

	test("the page's answerer routes it to the page's write", async () => {
		const asked: unknown[] = []
		const answer = buildWidgetRequestAnswerer({
			sessionId: () => 5,
			writeBackdrop: async (ask: unknown) => {
				asked.push(ask)
				return { sessionId: 5, backdropMediaId: null }
			}
		} as unknown as WidgetRequestDeps)
		await expect(
			answer("set-backdrop", { mediaRef: null }, { owner: "core", widgetId: "backdrop" } as any)
		).resolves.toBeUndefined()
		expect(asked).toEqual([{ sessionId: 5, mediaRef: null }])
	})
})

describe("session-images (the chooser's From this session)", () => {
	/** A raw line as the server pages it: one picture part per id. */
	const line = (id: number, role: string, assetIds: number[], over: Record<string, unknown> = {}) => ({
		id,
		role,
		speakerLabel: role === "user" ? "You" : "Narrator",
		channel: "main",
		isHidden: false,
		parts: assetIds.map((assetId, i) => ({
			id: id * 10 + i,
			type: "core:image",
			step: 0,
			ordinal: i,
			revision: 0,
			data: { assetId, alt: `pic ${assetId}` }
		})),
		...over
	})

	test("is core's alone to ask", () => {
		expect(WIDGET_REQUEST_ASKERS["session-images"]).toBe("core")
		expect(widgetRequestRefusal("session-images", { owner: "core" })).toBeNull()
		expect(widgetRequestRefusal("session-images", { owner: "acme.rp", grants: ["characters"] })).toMatch(/./)
	})

	test("answers the generated pictures of a messages page, newest first, by file id, and passes the cursor through", async () => {
		const asks: unknown[] = []
		const deps = {
			messagesPage: async (ask: Record<string, unknown>) => {
				asks.push(ask)
				return {
					rows: [
						line(1, "assistant", [11]),
						line(2, "user", [22]),
						line(3, "assistant", [33, 34]),
						line(4, "assistant", [44], { isHidden: true })
					],
					nextCursor: "1"
				}
			}
		}
		const first = await answerSessionImages(undefined, deps)
		expect(first.images.map((i) => i.ref)).toEqual(["33", "34", "11"])
		expect(first.images[0]!.src).toBe("/media/33?v=thumb")
		expect(first.nextCursor).toBe("1")
		await answerSessionImages({ cursor: "1" }, deps)
		expect(asks).toEqual([{}, { beforeId: 1 }])
		await expect(answerSessionImages({ cursor: "x" }, deps)).rejects.toThrow(/cursor/)
	})

	test("a page with no generated picture answers none, and the last page no cursor", async () => {
		const res = await answerSessionImages(undefined, {
			messagesPage: async () => ({ rows: [line(1, "user", [5])] })
		})
		expect(res).toEqual({ images: [] })
	})

	test("the page's answerer routes it to the page's messages read", async () => {
		const answer = buildWidgetRequestAnswerer({
			messagesPage: async () => ({ rows: [line(9, "assistant", [90])] })
		} as unknown as WidgetRequestDeps)
		const res = (await answer("session-images", {}, { owner: "core", widgetId: "backdrop" } as any)) as any
		expect(res.images.map((i: any) => i.ref)).toEqual(["90"])
	})
})
