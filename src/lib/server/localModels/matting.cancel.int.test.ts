/**
 * The background remover's download can be cancelled
 * (`localModels:cancelMatting`), the same way the connection lanes' ONNX
 * downloads are: the file in flight runs to its own end (transformers.js takes
 * no signal), then the partial directory and the `local_models` row are
 * removed and the state settles as `not_downloaded`, with no notification.
 * `@huggingface/transformers` is mocked whole; no model is downloaded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, notifySpy, gate } = vi.hoisted(() => {
	let current: unknown
	const gate: { open: () => void; wait: Promise<void>; reached: Promise<void>; hit: () => void } =
		{} as any
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		notifySpy: vi.fn(async () => {}),
		gate
	}
})

function resetGate() {
	gate.wait = new Promise<void>((r) => (gate.open = r))
	gate.reached = new Promise<void>((r) => (gate.hit = r))
}

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))

vi.mock("$lib/server/notifications/downloads", () => ({
	notifyDownloadSettled: notifySpy,
	downloadHref: () => "/admin/connections"
}))

vi.mock("$lib/server/sockets/utils/userPush", () => ({
	pushToConnectedAdmins: vi.fn()
}))

/** The "model" writes half a file, then waits for the test to let it end. */
vi.mock("@huggingface/transformers", async () => {
	const fs = await import("node:fs/promises")
	const path = await import("node:path")
	return {
		AutoConfig: { from_pretrained: vi.fn(async () => ({})) },
		ModelRegistry: {
			get_pipeline_files: vi.fn(async () => ["config.json", "onnx/model.onnx"])
		},
		AutoModelForImageSegmentation: {
			from_pretrained: vi.fn(async (id: string, opts: any) => {
				const dir = path.join(opts.cache_dir, id, "onnx")
				await fs.mkdir(dir, { recursive: true })
				await fs.writeFile(path.join(dir, "model.onnx"), Buffer.alloc(64))
				opts?.progress_callback?.({
					status: "progress",
					file: "onnx/model.onnx",
					loaded: 50,
					total: 100
				})
				gate.hit()
				await gate.wait
				return { dispose: vi.fn() }
			})
		},
		AutoProcessor: { from_pretrained: vi.fn(async () => ({})) }
	}
})

import {
	MATTING_CANCELLED_MESSAGE,
	MATTING_MODEL_ID,
	downloadMattingModel,
	mattingModelDir,
	mattingModelState,
	mattingRow,
	resetMattingForTests
} from "./matting"
import { clearCachedScans } from "./onnxCache"

let testDb: TestDb
let db: Db
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-matting-cancel-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	delete process.env.TRANSFORMERS_CACHE
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	resetMattingForTests()
	clearCachedScans()
	resetGate()
	notifySpy.mockClear()
})

const exists = (p: string) =>
	fs.stat(p).then(
		() => true,
		() => false
	)

describe("cancelling the background remover's download", () => {
	test("mid-download: the partial files and the row go, the state is not_downloaded", async () => {
		const run = downloadMattingModel(db, { userId: 1 })
		const settled = run.then(
			() => null,
			(e: Error) => e
		)
		await gate.reached

		const dir = mattingModelDir()!
		expect(await exists(path.join(dir, "onnx", "model.onnx"))).toBe(true)
		expect((await mattingRow(db))?.status).toBe("downloading")

		const { localModelsCancelMatting } = await import("$lib/server/sockets/loadouts")
		const emitted: Array<{ event: string; data: any }> = []
		const res = await localModelsCancelMatting.handler(
			{ user: { id: 1, isAdmin: true } } as any,
			{},
			(event: string, data: any) => emitted.push({ event, data })
		)
		expect(res).toEqual({ cancelled: true })
		// Still downloading — the file in flight has not ended — but saying so.
		expect(emitted.find((e) => e.event === "localModels:matting")?.data).toMatchObject({
			state: "downloading",
			cancelling: true
		})

		gate.open()
		const err = await settled
		expect(err?.message).toBe(MATTING_CANCELLED_MESSAGE)

		expect(await mattingModelState(db)).toEqual({ state: "not_downloaded" })
		expect(await mattingRow(db)).toBeNull()
		expect(await exists(dir)).toBe(false)
		expect(notifySpy).not.toHaveBeenCalled()
	})

	test("with nothing downloading, a cancel says so and changes nothing", async () => {
		const { localModelsCancelMatting } = await import("$lib/server/sockets/loadouts")
		const res = await localModelsCancelMatting.handler(
			{ user: { id: 1, isAdmin: true } } as any,
			{},
			() => {}
		)
		expect(res).toEqual({ cancelled: false })
	})

	test("an uncancelled download still settles on disk", async () => {
		const run = downloadMattingModel(db, { userId: 1 })
		await gate.reached
		gate.open()
		await run
		expect((await mattingModelState(db)).state).toBe("on_disk")
		expect((await mattingRow(db))?.status).toBe("complete")
		expect(MATTING_MODEL_ID).toContain("BiRefNet")
	})
})
