/**
 * The session page's tray (PLAN-composer-attachments §3.1, §3.3; D4):
 *
 *  - an upload sends the file's first 4100 bytes as `head`, then 1 MiB
 *    chunks from offset 0, each only after the last one's ack, then
 *    `finish` — and the tile follows (uploading, its progress, ready);
 *  - a refused `begin` leaves a refused tile with the server's sentence;
 *  - the `attachments:list` push (what a Send triggers) clears sent tiles;
 *  - the readers reach the composer as `AttachmentReadersV1`, naming a
 *    model only when the server left the pair on (an administrator);
 *  - another session's push is not this tray's;
 *  - removing a tile mid-upload stops it and removes the server's item.
 */
import { describe, expect, test } from "vitest"
import { createComposerTray, readersV1 } from "./composerTray.svelte"
import type { AttachmentReaders, TrayItemView } from "$lib/shared/sockets/attachments"

const MiB = 1024 * 1024

function fakeTransport() {
	const handlers = new Map<string, Set<(d: any) => void>>()
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit(event: string, data: unknown) {
			sent.push({ event, data })
		},
		on(event: string, handler: (d: any) => void) {
			if (!handlers.has(event)) handlers.set(event, new Set())
			handlers.get(event)!.add(handler)
			return () => handlers.get(event)!.delete(handler)
		},
		push(event: string, data: unknown) {
			for (const h of handlers.get(event) ?? []) h(data)
		},
		listeners: (event: string) => handlers.get(event)?.size ?? 0
	}
}

/** Lets the tray's awaited `arrayBuffer()` reads and replies run. */
const tick = async (n = 5) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

const fileOf = (bytes: number, name = "cat.png") => {
	const body = new Uint8Array(bytes)
	body.set([0x89, 0x50, 0x4e, 0x47])
	for (let i = 4; i < bytes; i++) body[i] = i % 251
	return new File([body], name, { type: "image/png" })
}

const view = (over: Partial<TrayItemView> = {}): TrayItemView => ({
	id: "t-1",
	sessionId: 7,
	status: "ready",
	refusal: null,
	filename: "cat.png",
	bytes: 10,
	position: 1,
	attachmentKind: "image",
	mime: "image/png",
	file: { id: 3, uuid: "u", width: 8, height: 8, url: "/media/3", thumbUrl: "/media/3?v=thumb" },
	createdAt: "2026-10-02T00:00:00Z",
	...over
})

describe("createComposerTray", () => {
	test("head of 4100 bytes, then 1 MiB chunks from offset 0, each after the last ack, then finish", async () => {
		const t = fakeTransport()
		const tray = createComposerTray(t, { sessionId: () => 7 })
		const file = fileOf(2 * MiB + 5)
		tray.attach([file])
		await tick()

		const begin = t.sent.find((s) => s.event === "attachments:begin")!
		expect(begin.data.sessionId).toBe(7)
		expect(begin.data.bytes).toBe(file.size)
		expect(begin.data.head).toBeInstanceOf(Uint8Array)
		expect(begin.data.head.byteLength).toBe(4100)
		expect(tray.view[0]).toMatchObject({ status: "uploading", progress: 0, filename: "cat.png" })

		t.push("attachments:begin", { sessionId: 7, trayItemId: "t-1", chunkBytes: MiB, filename: "cat.png" })
		await tick()
		const chunks = () => t.sent.filter((s) => s.event === "attachments:chunk")
		// One chunk at a time: the second waits for the first's ack.
		expect(chunks().map((c) => c.data.index)).toEqual([0])
		expect(chunks()[0].data.data.byteLength).toBe(MiB)
		expect(chunks()[0].data.data[0]).toBe(0x89)

		t.push("attachments:chunk", { sessionId: 7, trayItemId: "t-1", index: 0, received: MiB, bytes: file.size })
		await tick()
		expect(chunks().map((c) => c.data.index)).toEqual([0, 1])
		expect(tray.view[0].id).toBe("t-1")
		expect(tray.view[0].progress).toBeCloseTo(MiB / file.size)

		t.push("attachments:chunk", { sessionId: 7, trayItemId: "t-1", index: 1, received: 2 * MiB, bytes: file.size })
		await tick()
		expect(chunks().map((c) => c.data.index)).toEqual([0, 1, 2])
		expect(chunks()[2].data.data.byteLength).toBe(5)
		expect(t.sent.some((s) => s.event === "attachments:finish")).toBe(false)

		t.push("attachments:chunk", { sessionId: 7, trayItemId: "t-1", index: 2, received: file.size, bytes: file.size })
		await tick()
		expect(t.sent.at(-1)).toEqual({ event: "attachments:finish", data: { trayItemId: "t-1" } })

		t.push("attachments:finish", { sessionId: 7, trayItem: view({ bytes: file.size }) })
		await tick()
		expect(tray.view).toEqual([
			{
				id: "t-1",
				status: "ready",
				progress: 1,
				refusal: null,
				filename: "cat.png",
				bytes: file.size,
				kind: "image",
				thumbSrc: "/media/3?v=thumb"
			}
		])
		expect(tray.sendableIds()).toEqual(["t-1"])
		tray.destroy()
	})

	test("a refused begin leaves a refused tile with the server's sentence, and nothing more is sent", async () => {
		const t = fakeTransport()
		const tray = createComposerTray(t, { sessionId: () => 7 })
		tray.attach([fileOf(20, "cat.svg")])
		await tick()
		t.push("attachments:begin:error", { sessionId: 7, error: "An SVG can't be attached." })
		await tick()
		expect(tray.view[0]).toMatchObject({ status: "refused", refusal: "An SVG can't be attached." })
		expect(t.sent.map((s) => s.event)).toEqual(["attachments:readers", "attachments:begin"])
		expect(tray.sendableIds()).toEqual([])
		tray.destroy()
	})

	test("the list push after a Send clears the sent tiles; another session's push is not this tray's", async () => {
		const t = fakeTransport()
		const tray = createComposerTray(t, { sessionId: () => 7 })
		tray.load()
		t.push("attachments:list", { sessionId: 7, tray: [view(), view({ id: "t-2", position: 2, filename: "b.md", attachmentKind: "text", file: null })] })
		expect(tray.view.map((v) => v.id)).toEqual(["t-1", "t-2"])
		expect(tray.view[1].thumbSrc).toBeNull()
		// Another session's tray says nothing about this one.
		t.push("attachments:list", { sessionId: 8, tray: [] })
		t.push("attachments:remove", { sessionId: 8, trayItemId: "t-1" })
		expect(tray.view.map((v) => v.id)).toEqual(["t-1", "t-2"])
		// Sent: the server's tray is empty again.
		t.push("attachments:list", { sessionId: 7, tray: [] })
		expect(tray.view).toEqual([])
		tray.destroy()
	})

	test("removing a tile mid-upload stops its chunks and removes the server's item", async () => {
		const t = fakeTransport()
		const tray = createComposerTray(t, { sessionId: () => 7 })
		tray.attach([fileOf(3 * MiB)])
		await tick()
		t.push("attachments:begin", { sessionId: 7, trayItemId: "t-9", chunkBytes: MiB, filename: "cat.png" })
		await tick()
		tray.remove("t-9")
		t.push("attachments:chunk", { sessionId: 7, trayItemId: "t-9", index: 0, received: MiB, bytes: 3 * MiB })
		await tick()
		expect(t.sent.filter((s) => s.event === "attachments:chunk").length).toBe(1)
		expect(t.sent.some((s) => s.event === "attachments:finish")).toBe(false)
		expect(t.sent.at(-1)).toEqual({ event: "attachments:remove", data: { trayItemId: "t-9" } })
		expect(tray.view).toEqual([])
		tray.destroy()
	})

	test("destroy releases every listener it took", () => {
		const t = fakeTransport()
		const tray = createComposerTray(t, { sessionId: () => 7 })
		expect(t.listeners("attachments:list")).toBe(1)
		tray.destroy()
		expect(t.listeners("attachments:list")).toBe(0)
		expect(t.listeners("attachments:readers")).toBe(0)
	})
})

describe("readersV1", () => {
	const readers = (connection?: AttachmentReaders["calls"][number]["connection"]): AttachmentReaders => ({
		kinds: {
			image: { allowed: false, reason: "No model in this reply can read images." },
			text: { allowed: true },
			pdf: { allowed: false, reason: "No model in this reply can read PDFs." }
		},
		calls: [
			{
				key: "respond",
				label: "Reply",
				reads: ["text"],
				placeholderFor: ["image", "pdf"],
				reasons: { image: "x" },
				...(connection ? { connection } : {})
			}
		],
		accepts: { image: [], text: ["text/plain", ".txt", ".md"], pdf: [] },
		limits: { filesPerMessage: 10, bytesPerKind: { image: 20 * MiB, text: MiB, pdf: 32 * MiB } }
	})

	test("the picker's accept is the allowed kinds' formats; caps ride along", () => {
		const v = readersV1(readers())
		expect(v.accept).toBe("text/plain,.txt,.md")
		expect(v.filesPerMessage).toBe(10)
		expect(v.bytesPerKind.text).toBe(MiB)
		expect(v.kinds.image).toEqual({ allowed: false, reason: "No model in this reply can read images." })
	})

	test("a call names its model only when the server left the pair on (an administrator)", () => {
		expect(readersV1(readers()).calls[0]).not.toHaveProperty("model")
		const admin = readersV1(readers({ name: "Local Kobold", type: "koboldcpp", model: "nemo-12b" } as any))
		expect(admin.calls[0].model).toBe("nemo-12b")
	})
})
