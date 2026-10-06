/**
 * A local ONNX download writes every file under its OWN modality's cache
 * directory — with the REAL transformers.js, and the Hub stood in for by
 * `env.fetch`.
 *
 * The regression: `pipeline()` reads a repo's `config.json` with no cache
 * directory while deciding which files to fetch, so it landed in
 * `env.cacheDir` — the one global the embedding loader points at ITS
 * directory — and an entity model's download left a stray `config.json` among
 * the embedding weights. Here `env.cacheDir` is that embedding directory, as
 * it is once the embedding lane has loaded, and it must stay empty.
 *
 * The weights are not real, so the download settles as an error when the
 * runtime refuses them — after every file has been fetched. The files are
 * what is under test, not the model.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

const REPO = "test-org/tiny-ner"

/** The repo, as the Hub would serve it. Small, and valid where it is parsed. */
const HUB_FILES: Record<string, string> = {
	"config.json": JSON.stringify({
		model_type: "bert",
		architectures: ["BertForTokenClassification"],
		id2label: { "0": "O", "1": "B-PER" },
		label2id: { O: 0, "B-PER": 1 }
	}),
	"tokenizer_config.json": JSON.stringify({
		tokenizer_class: "BertTokenizer",
		model_max_length: 512
	}),
	"tokenizer.json": JSON.stringify({
		version: "1.0",
		truncation: null,
		padding: null,
		added_tokens: [],
		normalizer: null,
		pre_tokenizer: { type: "Whitespace" },
		post_processor: null,
		decoder: null,
		model: {
			type: "WordPiece",
			unk_token: "[UNK]",
			continuing_subword_prefix: "##",
			max_input_chars_per_word: 100,
			vocab: { "[UNK]": 0, hello: 1 }
		}
	}),
	"onnx/model.onnx": "not really weights"
}

/** `fetch`, as the Hub: a file by its resolve URL, a Range request by size. */
async function hubFetch(input: any, init?: any): Promise<Response> {
	const url = String(input)
	const prefix = `https://huggingface.co/${REPO}/resolve/main/`
	const body = url.startsWith(prefix)
		? HUB_FILES[url.slice(prefix.length)]
		: undefined
	if (body === undefined) return new Response("Not found", { status: 404 })
	const bytes = Buffer.from(body)
	const range = new Headers(init?.headers).get("Range")
	if (range)
		return new Response(bytes.subarray(0, 1), {
			status: 206,
			headers: { "content-range": `bytes 0-0/${bytes.length}` }
		})
	return new Response(bytes, {
		status: 200,
		headers: { "content-length": String(bytes.length) }
	})
}

/** Every file under a directory, relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
	const out: string[] = []
	async function walk(at: string) {
		let entries: import("node:fs").Dirent[]
		try {
			entries = await fs.readdir(at, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			const full = path.join(at, e.name)
			if (e.isDirectory()) await walk(full)
			else out.push(path.relative(dir, full))
		}
	}
	await walk(dir)
	return out.sort()
}

let testDb: TestDb
let dataDir: string
let transformersEnv: any
let restore: { cacheDir: string; fetch: any }
const runs = (
	await import("$lib/server/localModels/onnxRuntime").then((m) =>
		m.localOnnxAvailability()
	)
).available

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-onnx-cache-dir-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(async () => {
	if (!runs) return
	transformersEnv = (await import("@huggingface/transformers")).env
	const { cacheDirFor } = await import("$lib/server/localModels/onnxCache")
	restore = {
		cacheDir: transformersEnv.cacheDir,
		fetch: transformersEnv.fetch
	}
	// What the embedding loader leaves behind once it has loaded.
	transformersEnv.cacheDir = cacheDirFor("embeddings")
	transformersEnv.fetch = hubFetch
})

afterEach(() => {
	if (!runs) return
	transformersEnv.cacheDir = restore.cacheDir
	transformersEnv.fetch = restore.fetch
})

describe.skipIf(!runs)("an entity model's download", () => {
	it("writes every file under the entity directory, none in the embedding one", async () => {
		const [conn] = await testDb
			.insert(schema.connections)
			.values({
				name: "Local named entities",
				type: CONNECTION_TYPE.LOCAL_ONNX_NER,
				modality: "ner",
				extraJson: {}
			} as any)
			.returning()
		const [row] = await testDb
			.insert(schema.connectionModels)
			.values({ connectionId: conn.id, model: REPO, name: REPO })
			.returning()

		const { connectionsDownloadModel } = await import("./localOnnxModels")
		const { activeDownload, cacheDirFor } = await import(
			"$lib/server/localModels/onnxCache"
		)
		await connectionsDownloadModel.handler(
			{ user: { id: 1, isAdmin: true } } as any,
			{ id: conn.id, modelId: row.id },
			() => {}
		)
		await activeDownload("ner", REPO)?.settled

		const nerDir = path.join(cacheDirFor("ner"), ...REPO.split("/"))
		// The tokenizer is fetched beside the model, and the runtime's refusal
		// of the weights can settle the download before its last write lands.
		for (let i = 0; i < 50; i++) {
			if ((await filesUnder(nerDir)).length === 4) break
			await new Promise((r) => setTimeout(r, 20))
		}
		expect(await filesUnder(nerDir)).toEqual([
			"config.json",
			path.join("onnx", "model.onnx"),
			"tokenizer.json",
			"tokenizer_config.json"
		])
		expect(await filesUnder(cacheDirFor("embeddings"))).toEqual([])
	}, 60_000)
})
