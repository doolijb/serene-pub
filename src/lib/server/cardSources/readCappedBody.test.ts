/**
 * A remote card's body is read with a ceiling, and the read stops the moment
 * the ceiling passes (lorebooks plan S4) — CharaVault and the GitHub catalogue
 * both read `arrayBuffer()` of whatever the server sent.
 *
 * The hostile bodies are STREAMS that count what was pulled from them, so the
 * tests can tell "refused after reading everything" from "stopped mid-stream".
 * None is endless: a regression reads 100 MB and fails, it does not hang.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { IMPORT_FILE_CAPS, MIB } from "$lib/shared/imports/fileCaps"
import { readCappedBody } from "./readCappedBody"

vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("./charaVault/session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./charaVault/session")>()
	return {
		...actual,
		hasActiveSession: () => false,
		withCharaVaultSession: async (
			requestFn: (cookie: string | null) => Promise<Response>,
			parseResponse: (response: Response) => Promise<unknown>
		) => parseResponse(await requestFn(null))
	}
})

/** A body of `chunks` × 1 MiB, counting pulls and noticing a cancel. */
function countedBody(chunks: number) {
	const state = { pulled: 0, cancelled: false }
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (state.pulled >= chunks) return controller.close()
			state.pulled++
			controller.enqueue(new Uint8Array(MIB))
		},
		cancel() {
			state.cancelled = true
		}
	})
	return { stream, state }
}

const outcomeOf = (work: Promise<unknown>) =>
	work.then(
		(v) => (Buffer.isBuffer(v) ? `bytes:${v.length}` : "resolved"),
		(e) => String(e?.message ?? e)
	)

let dataDir: string
beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-bodycap-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
})
afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("readCappedBody", () => {
	test("stops mid-stream once the ceiling passes, cancelling the body and aborting", async () => {
		const { stream, state } = countedBody(100)
		const abort = new AbortController()
		expect(
			await outcomeOf(readCappedBody(new Response(stream), 8 * MIB, abort))
		).toBe("This card file is larger than the 8 MB Serene Pub will read.")
		expect(state.pulled).toBeLessThan(12)
		expect(state.cancelled).toBe(true)
		expect(abort.signal.aborted).toBe(true)
	})

	test("a declared Content-Length over the ceiling is refused before the body is read", async () => {
		const { stream, state } = countedBody(100)
		const res = new Response(stream, {
			headers: { "content-length": String(100 * MIB) }
		})
		expect(await outcomeOf(readCappedBody(res, 8 * MIB))).toMatch(
			/larger than the 8 MB/
		)
		expect(state.pulled).toBeLessThanOrEqual(1)
	})

	test("a body under the ceiling comes back whole", async () => {
		const { stream } = countedBody(3)
		expect(await outcomeOf(readCappedBody(new Response(stream), 8 * MIB))).toBe(
			`bytes:${3 * MIB}`
		)
	})
})

describe("the card sources read with it", () => {
	test("CharaVault stops reading a card body past the card ceiling", async () => {
		const { stream, state } = countedBody(100)
		vi.spyOn(global, "fetch").mockResolvedValue(
			new Response(stream, { status: 200 })
		)
		const { charaVaultSource } = await import("./charaVault/charaVaultSource")
		expect(
			await outcomeOf(
				charaVaultSource.getCardBytes(
					{ folder: "f", file: "huge.png" },
					{ userId: 1 }
				)
			)
		).toBe(
			`This card file is larger than the ${IMPORT_FILE_CAPS.cardBytes / MIB} MB Serene Pub will read.`
		)
		expect(state.pulled).toBeLessThan(IMPORT_FILE_CAPS.cardBytes / MIB + 4)
		expect(state.cancelled).toBe(true)
	}, 30_000)

	test("the GitHub catalogue stops reading a card body past the card ceiling", async () => {
		const { stream, state } = countedBody(100)
		vi.spyOn(global, "fetch").mockResolvedValue(
			new Response(stream, { status: 200 })
		)
		const { fetchGithubCardBytes } = await import("./githubYamlCardSource")
		expect(await outcomeOf(fetchGithubCardBytes("cards/huge.png"))).toMatch(
			/larger than the \d+ MB Serene Pub will read/
		)
		expect(state.pulled).toBeLessThan(IMPORT_FILE_CAPS.cardBytes / MIB + 4)
	}, 30_000)
})
