/**
 * Two kinds of model file, in two directories, reaching generation through two
 * kinds of connection — and almost every way that can go wrong here is silent.
 *
 * The directory scan deletes the row of every complete model it did not see, so
 * the moment there are two directories, scanning one deletes the other's rows:
 * silently, on the first listing after the second directory is set, looking
 * exactly like every model the user owns disappearing. A kind guessed from a
 * filename files the maintainer's own image models (all of them `.gguf`) as text
 * LLMs. A kind taken from the FOLDER and never re-checked offers an LLM dropped
 * into the image folder as something that can draw. A connection created without
 * resolved capabilities works by accident — an empty column reads as
 * "undetermined", so the guard falls through to its modality test — right up
 * until something resolves it into an empty set. None of those surface as a
 * crash, so they are all pinned here.
 *
 * https/http are mocked so the fire-and-forget download IIFE never resolves (as
 * the other koboldcpp download int tests do), and fetch is routed per-URL so no
 * test here reaches Hugging Face.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let testDb: TestDb
let dataDir: string
let modelsDir: string
let imageModelsDir: string

// --- GGUF fixtures, same headers as modelKind.test.ts ------------------------

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex")

function gstr(s: string): Buffer {
	const bytes = Buffer.from(s, "utf8")
	const len = Buffer.alloc(8)
	len.writeBigUInt64LE(BigInt(bytes.length))
	return Buffer.concat([len, bytes])
}

/** An SD.CPP GGUF: 2643 tensors, zero metadata KV pairs. */
const SD_GGUF = Buffer.concat([
	hex(
		"47 47 55 46  03 00 00 00  53 0a 00 00 00 00 00 00  00 00 00 00 00 00 00 00"
	),
	gstr("cond_stage_model.logit_scale")
])

/** A text LLM: 147 tensors, 35 KV pairs, general.architecture = "llama". */
const TEXT_GGUF = hex(`
	47 47 55 46  03 00 00 00
	93 00 00 00  00 00 00 00
	23 00 00 00  00 00 00 00
	14 00 00 00  00 00 00 00
	67 65 6e 65 72 61 6c 2e 61 72 63 68 69 74 65 63 74 75 72 65
	08 00 00 00
	05 00 00 00  00 00 00 00
	6c 6c 61 6d 61
`)

// --- fetch routing -----------------------------------------------------------

let fetchRoutes: Array<{ match: RegExp; respond: () => any }> = []
let fetchedUrls: string[] = []

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: any) => {
			const href = String(url)
			fetchedUrls.push(href)
			for (const route of fetchRoutes) {
				if (route.match.test(href)) return route.respond()
			}
			// Everything unrouted behaves like an unreachable koboldcpp, which
			// is what listModels' own try/catch is written for.
			throw new Error(`unrouted fetch: ${href}`)
		})
	)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-image-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-image-models-dir-")
	)
	imageModelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-image-image-dir-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
	// The image column starts NULL, which is the shape of every upgraded
	// install: one flat directory, and image models resolving to it. The blocks
	// that need two directories set it themselves and put it back.
	await testDb.insert(schema.koboldCppSettings).values({
		id: 1,
		koboldCppManagerEnabled: true,
		koboldCppManagerModelsDir: modelsDir
	})
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await fs.rm(dataDir, { recursive: true, force: true })
	await fs.rm(modelsDir, { recursive: true, force: true })
	await fs.rm(imageModelsDir, { recursive: true, force: true })
})

beforeEach(() => {
	fetchRoutes = []
	fetchedUrls = []
	stubFetch()
})

const socket = { user: { id: 1, isAdmin: true } } as any
const noopEmit = () => {}

const modelRow = (filename: string) =>
	testDb.query.koboldCppModels.findFirst({
		where: eq(schema.koboldCppModels.filename, filename)
	})

const imageConnections = () =>
	testDb.query.connections.findMany({
		where: eq(
			schema.connections.type,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		)
	})

const imageDefault = () =>
	testDb.query.connectionDefaults.findFirst({
		where: byCapability("text->image")
	})

const setImageModelsDir = (dir: string | null) =>
	testDb
		.update(schema.koboldCppSettings)
		.set({ koboldCppImageModelsDir: dir })
		.where(eq(schema.koboldCppSettings.id, 1))

async function listModels() {
	const { koboldCppListModelsHandler } = await import("./koboldcpp")
	return koboldCppListModelsHandler.handler(socket, {}, noopEmit)
}

async function connectImageModel(filename: string) {
	const { koboldCppConnectImageModelHandler } = await import("./koboldcpp")
	return koboldCppConnectImageModelHandler.handler(
		socket,
		{ filename },
		noopEmit
	)
}

describe("koboldcpp:listModels — one directory holding two kinds of file", () => {
	test("a downloaded .safetensors survives the stale sweep", async () => {
		// The sweep deletes the row of every complete model the scan did not
		// see. A .gguf-only scan therefore deletes a perfectly good
		// .safetensors row on the next listing, while the file is still there —
		// which is why widening the scan is not optional once the download path
		// can write one.
		const filename = "sd_xl_base_1.0.safetensors"
		await fs.writeFile(path.join(modelsDir, filename), "not really a model")
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: "SDXL Base",
			status: "complete",
			kind: "image",
			kindSource: "user"
		})

		const res = await listModels()

		expect(await modelRow(filename)).toBeTruthy()
		expect(res.availableModels.map((m) => m.name)).toContain(filename)
	})

	test("a hand-placed SD.CPP gguf is discovered as an image model, not a text one", async () => {
		// The central trap: this file is a .gguf sitting beside text LLMs and is
		// indistinguishable from one by name. Every model in the maintainer's
		// own curated image repo looks exactly like this — and the folder it is
		// in says "text", so the header read has to be able to overrule it.
		const filename = "imgmodel_xl_q4_0.gguf"
		await fs.writeFile(path.join(modelsDir, filename), SD_GGUF)

		const res = await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("image")
		expect(rec!.kindSource).toBe("detected")
		const listed = res.availableModels.find((m) => m.name === filename)!
		expect(listed.kind).toBe("image")
		// Where it was found, which is evidence and not a verdict — the two
		// disagree here, and both are reported.
		expect(listed.dirKind).toBe("text")
	})

	test("the migration's assumed 'text' is corrected by the first scan", async () => {
		// Upgrade day. Every pre-existing row backfills to text/assumed, which
		// is what the app had silently been claiming; "assumed" is what marks it
		// for this re-read, so an install that already had an SD model in the
		// folder corrects itself with nobody told to go looking.
		const filename = "picx_real_q4_0.gguf"
		await fs.writeFile(path.join(modelsDir, filename), SD_GGUF)
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: "picx_real_q4_0",
			status: "complete",
			kind: "text",
			kindSource: "assumed"
		})

		await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("image")
		expect(rec!.kindSource).toBe("detected")
	})

	test("a text LLM is left as text", async () => {
		const filename = "Llama-3.2-1B-Instruct-Q4_K_M.gguf"
		await fs.writeFile(path.join(modelsDir, filename), TEXT_GGUF)

		await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("text")
		expect(rec!.kindSource).toBe("detected")
	})

	test("nothing automatic overwrites what a human said", async () => {
		// The top of the trust order. A user who has told the app what a file is
		// must not have to keep telling it every time the directory is listed.
		const filename = "user-says-text.gguf"
		await fs.writeFile(path.join(modelsDir, filename), SD_GGUF)
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: "user-says-text",
			status: "complete",
			kind: "text",
			kindSource: "user"
		})

		await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("text")
		expect(rec!.kindSource).toBe("user")
	})

	test("a file the classifier cannot read keeps the claim of the folder it is in", async () => {
		// An indefinite header read is not a reason to throw away the only
		// evidence there is, which is where the file was put — and "declared"
		// stays in the re-sniff set, so a file that was merely mid-copy is
		// measured again on the very next listing. The reason is still reported,
		// which is what the Unverified badge's tooltip shows.
		const filename = "half-a-download.gguf"
		await fs.writeFile(path.join(modelsDir, filename), hex("47 47 55 46"))

		const res = await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("text")
		expect(rec!.kindSource).toBe("declared")
		const listed = res.availableModels.find((m) => m.name === filename)!
		expect(listed.kindReason).toMatch(/shorter than/i)
	})

	test("with no image directory configured, image models still have one", async () => {
		// NULL on that column is the upgrade contract, not a missing value: it
		// resolves to the text directory for reads AND writes, so an install
		// with one flat folder keeps working with nothing moved.
		const res = await listModels()

		expect(res.modelsDirSet).toBe(true)
		// One directory, scanned once — a naive two-directory scan would report
		// every file twice under two different dirKinds.
		expect(res.availableModels.every((m) => m.dirKind === "text")).toBe(
			true
		)
	})
})

describe("koboldcpp:listModels — two directories", () => {
	beforeAll(async () => {
		await setImageModelsDir(imageModelsDir)
	})

	afterAll(async () => {
		await setImageModelsDir(null)
	})

	test("a model in each directory survives the other's scan", async () => {
		// THE failure this whole listing is arranged around. The sweep deletes
		// the row of every complete model the scan did not see, so a
		// scan-then-sweep per directory would delete every image model while
		// scanning the LLM folder and vice versa — silently, on the first
		// listing after a second directory is set, looking exactly like the
		// models vanished.
		const textFile = "in-the-llm-folder.gguf"
		const imageFile = "in-the-image-folder.safetensors"
		await fs.writeFile(path.join(modelsDir, textFile), TEXT_GGUF)
		await fs.writeFile(path.join(imageModelsDir, imageFile), "sdxl bytes")
		await testDb.insert(schema.koboldCppModels).values([
			{
				filename: textFile,
				modelName: "In The LLM Folder",
				status: "complete",
				kind: "text",
				kindSource: "user"
			},
			{
				filename: imageFile,
				modelName: "In The Image Folder",
				status: "complete",
				kind: "image",
				kindSource: "user"
			}
		])

		const res = await listModels()

		expect(await modelRow(textFile)).toBeTruthy()
		expect(await modelRow(imageFile)).toBeTruthy()
		const names = res.availableModels.map((m) => m.name)
		expect(names).toContain(textFile)
		expect(names).toContain(imageFile)
		expect(
			res.availableModels.find((m) => m.name === imageFile)!.dirKind
		).toBe("image")
	})

	test("an LLM dropped into the image folder is re-sniffed off the folder's claim", async () => {
		// The folder is a signal, never the authority. Without "declared" in the
		// re-sniff set the folder's claim is never revisited, and this file is
		// offered as an image model forever — where picking it points sdmodel at
		// a language model and every render fails.
		const filename = "wrong-folder-llama.gguf"
		await fs.writeFile(path.join(imageModelsDir, filename), TEXT_GGUF)

		const res = await listModels()

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("text")
		expect(rec!.kindSource).toBe("detected")
		const listed = res.availableModels.find((m) => m.name === filename)!
		// Found in the image folder, and still not an image model.
		expect(listed.dirKind).toBe("image")
		expect(listed.kind).toBe("text")
	})

	test("a directory that could not be read stops the sweep rather than emptying it", async () => {
		// A partial union is not evidence that anything is missing. Deleting on
		// the strength of one unreadable directory is precisely the "all my
		// models vanished" failure, and the cost of not sweeping is a row nobody
		// ever sees — the listing is driven by the scan, not by the table.
		const filename = "still-tracked.gguf"
		await fs.writeFile(path.join(modelsDir, filename), TEXT_GGUF)
		await listModels()
		expect(await modelRow(filename)).toBeTruthy()

		await fs.rm(path.join(modelsDir, filename))
		await setImageModelsDir(path.join(imageModelsDir, "not-created-yet"))
		await listModels()

		expect(await modelRow(filename)).toBeTruthy()

		// ...and once every directory answers again, the sweep does its job.
		await setImageModelsDir(imageModelsDir)
		await listModels()
		expect(await modelRow(filename)).toBeUndefined()
	})
})

describe("koboldcpp:downloadModel — declaring a kind and picking a directory", () => {
	const download = async (params: any) => {
		const { koboldCppDownloadModelHandler } = await import("./koboldcpp")
		return koboldCppDownloadModelHandler.handler(socket, params, noopEmit)
	}

	test("a subdirectory filename is refused before it can ENOENT", async () => {
		// Root level only. `clip/t5xxl.safetensors` passes the containment check
		// quite legitimately and then fails inside createWriteStream, because
		// each models directory is flat and nothing creates a subtree under it.
		await expect(
			download({
				filename: "clip/t5xxl.safetensors",
				downloadUrl:
					"https://huggingface.co/someone/bundle/resolve/main/clip/t5xxl.safetensors",
				modelName: "t5xxl",
				kind: "image"
			})
		).rejects.toThrow(/root of a repository/i)
	})

	test("a filename that climbs out of the directory is refused", async () => {
		// The repo-root rule above catches this one first, which is the point of
		// having both: containment is checked per (directory, filename) PAIR
		// underneath, so even if that rule ever loosened, a name that is not its
		// own basename never reaches a join.
		await expect(
			download({
				filename: "../escaped.gguf",
				downloadUrl:
					"https://huggingface.co/someone/repo/resolve/main/escaped.gguf",
				modelName: "Escaped",
				kind: "text"
			})
		).rejects.toThrow()
		await expect(
			fs.stat(path.join(path.dirname(modelsDir), "escaped.gguf"))
		).rejects.toThrow()
	})

	test("a .safetensors cannot be pulled from the text tab", async () => {
		// koboldcpp loads text models from GGUF only, so this download could
		// never have produced a usable text model.
		await expect(
			download({
				filename: "sd_xl_base.safetensors",
				downloadUrl:
					"https://huggingface.co/someone/sdxl/resolve/main/sd_xl_base.safetensors",
				modelName: "SDXL",
				kind: "text"
			})
		).rejects.toThrow(/\.gguf only/i)
	})

	test("the row records the tab the user was in as a declaration, not a measurement", async () => {
		const filename = "declared-image-model.gguf"
		await download({
			filename,
			downloadUrl: `https://huggingface.co/koboldcpp/imgmodel/resolve/main/${filename}`,
			modelName: "Declared Image Model",
			kind: "image"
		})

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("image")
		// "declared" is a guess about a file; the completed bytes get the final
		// say, which is why this is not written as "detected".
		expect(rec!.kindSource).toBe("declared")
	})

	test("an absent kind still means text, so the existing text tab is unchanged", async () => {
		const filename = "no-kind-supplied.gguf"
		await download({
			filename,
			downloadUrl: `https://huggingface.co/someone/repo/resolve/main/${filename}`,
			modelName: "No Kind Supplied"
		})

		expect((await modelRow(filename))!.kind).toBe("text")
	})

	test("an image download targets the image directory, with no fallback to the text one", async () => {
		// The write side never falls back: a model lands in the folder for its
		// kind or the download does not happen. Observed through the mkdir,
		// since the download itself is mocked to never resolve — the directory
		// coming into existence is proof of which path was built.
		const freshImageDir = path.join(imageModelsDir, "created-on-demand")
		await setImageModelsDir(freshImageDir)
		try {
			await download({
				filename: "lands-in-the-image-folder.gguf",
				downloadUrl:
					"https://huggingface.co/koboldcpp/imgmodel/resolve/main/lands-in-the-image-folder.gguf",
				modelName: "Lands In The Image Folder",
				kind: "image"
			})

			await expect(fs.stat(freshImageDir)).resolves.toBeTruthy()
		} finally {
			await setImageModelsDir(null)
			await testDb
				.delete(schema.koboldCppModels)
				.where(
					eq(
						schema.koboldCppModels.filename,
						"lands-in-the-image-folder.gguf"
					)
				)
			await fs.rm(freshImageDir, { recursive: true, force: true })
		}
	})
})

describe("koboldcpp:connectImageModel — one image model, one connection", () => {
	beforeAll(async () => {
		await setImageModelsDir(imageModelsDir)
	})

	afterAll(async () => {
		await setImageModelsDir(null)
	})

	async function installedImageModel(
		filename: string,
		dir = imageModelsDir,
		kind: "image" | "text" = "image"
	) {
		await fs.writeFile(path.join(dir, filename), SD_GGUF)
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: filename.replace(/\.[^.]+$/, ""),
			status: "complete",
			kind,
			kindSource: "user"
		})
	}

	test("the new connection already knows it can draw", async () => {
		// The invisible failure. A raw insert bypasses connections:create, so a
		// row can land with `capabilities = {}` — which reads as "undetermined",
		// not as "cannot", so capabilityGuard's modality fallback lets it
		// through and everything works by accident until some unrelated write
		// resolves the row into an empty set and the picker changes underneath
		// the user.
		const filename = "sdxl-turbo-q8.gguf"
		await installedImageModel(filename)

		const res = await connectImageModel(filename)

		expect(res.success).toBeTruthy()
		const [conn] = await imageConnections()
		expect(conn.model).toBe(filename)
		expect(conn.modality).toBe("image-gen")
		expect((conn.capabilities as any).resolved["text->image"]).toBe(1)
	})

	test("it registers the text->image default without claiming the text one", async () => {
		// Both defaults live in `connection_defaults` now (0181) — this used to
		// assert that the image path did NOT touch
		// `system_settings.default_connection_id`, which was the column the chat
		// connection held. With one store the property is the same and sharper:
		// registering `text->image` must leave `text->text` alone. Nothing
		// derives a capability from a connection, precisely because this managed
		// KoboldCPP can serve both.
		const [conn] = await imageConnections()
		const textDefault = await testDb.query.connectionDefaults.findFirst({
			where: byCapability("text->text")
		})

		expect((await imageDefault())!.connectionId).toBe(conn.id)
		expect(textDefault?.connectionId ?? null).toBeNull()
	})

	test("connecting the same model twice reuses its connection", async () => {
		// The find-or-create half. Without it, every press of "Use for image
		// generation" leaves another identical connection behind and the
		// Connections list fills up with them.
		const filename = "sdxl-turbo-q8.gguf"

		await connectImageModel(filename)

		const rows = (await imageConnections()).filter(
			(c) => c.model === filename
		)
		expect(rows.length).toBe(1)
		expect((await imageDefault())!.connectionId).toBe(rows[0].id)
	})

	test("a text model is refused rather than pointed at sdmodel", async () => {
		// koboldcpp exit_with_error's on an image model it cannot load. That no
		// longer takes chat down with it — the two kinds never share a .kcpps —
		// but it does mean a connection that looks configured fails every
		// render, which is worth refusing at the point of choosing.
		const filename = "definitely-a-text-model.gguf"
		await installedImageModel(filename, imageModelsDir, "text")

		const res = await connectImageModel(filename)

		expect(res.error).toMatch(/text model/i)
		expect(
			(await imageConnections()).some((c) => c.model === filename)
		).toBe(false)
	})

	test("a model that isn't installed is refused rather than connected", async () => {
		const res = await connectImageModel("never-heard-of-it.gguf")

		expect(res.error).toMatch(/isn't installed/i)
		expect(
			(await imageConnections()).some(
				(c) => c.model === "never-heard-of-it.gguf"
			)
		).toBe(false)
	})

	test("a model still sitting in a legacy flat directory is accepted", async () => {
		// Nothing moves on disk, ever. An install that downloaded its image
		// models before there was a second directory has them in the LLM folder,
		// and the read-side fallback is the whole reason that keeps working with
		// no file migration.
		const filename = "downloaded-before-the-split.gguf"
		await installedImageModel(filename, modelsDir)

		const res = await connectImageModel(filename)

		expect(res.success).toBeTruthy()
		expect(
			(await imageConnections()).some((c) => c.model === filename)
		).toBe(true)
	})

	test("a model whose file has gone is refused rather than connected", async () => {
		const filename = "tracked-but-missing.gguf"
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: "Tracked But Missing",
			status: "complete",
			kind: "image",
			kindSource: "user"
		})

		const res = await connectImageModel(filename)

		expect(res.error).toMatch(/no longer on disk/i)
		await testDb
			.delete(schema.koboldCppModels)
			.where(eq(schema.koboldCppModels.filename, filename))
	})
})

describe("koboldcpp:deleteModel — the connections that named the file", () => {
	const deleteModel = async (modelName: string) => {
		const { koboldCppDeleteModelHandler } = await import("./koboldcpp")
		return koboldCppDeleteModelHandler.handler(
			socket,
			{ modelName },
			noopEmit
		)
	}

	test("an image connection naming the deleted file goes with it", async () => {
		// A connection whose model file is gone fails at render time with
		// nothing on the Connections screen to explain it. The text side has
		// always been cleaned up here; missing the image type would leave
		// exactly that.
		const filename = "about-to-be-deleted.gguf"
		await fs.writeFile(path.join(modelsDir, filename), SD_GGUF)
		await testDb.insert(schema.koboldCppModels).values({
			filename,
			modelName: "About To Be Deleted",
			status: "complete",
			kind: "image",
			kindSource: "user"
		})
		await connectImageModel(filename)
		expect(
			(await imageConnections()).some((c) => c.model === filename)
		).toBe(true)

		const res = await deleteModel(filename)

		expect(res.success).toBe(true)
		expect(await modelRow(filename)).toBeUndefined()
		expect(
			(await imageConnections()).some((c) => c.model === filename)
		).toBe(false)
		// ON DELETE SET NULL releases the slot rather than stranding it at an id
		// nothing answers to.
		expect((await imageDefault())?.connectionId ?? null).toBeNull()
	})

	test("a filename that tries to leave the models directory is refused", async () => {
		// Containment is a property of the (directory, filename) pair, and the
		// bare-name check runs before anything is joined — so this never reaches
		// a resolve, let alone an unlink.
		await expect(deleteModel("../escape.gguf")).rejects.toThrow(
			/invalid .*filename/i
		)
	})
})

describe("koboldcpp:setModelKind — the user's answer", () => {
	const setModelKind = async (filename: string, kind: "text" | "image") => {
		const { koboldCppSetModelKindHandler } = await import("./koboldcpp")
		return koboldCppSetModelKindHandler.handler(
			socket,
			{ filename, kind },
			noopEmit
		)
	}

	test("an override is recorded at the top of the trust order", async () => {
		// Without kind_source "user" the next directory scan would re-sniff the
		// row and overwrite the answer, making the override look like it never
		// took — which is exactly what "declared" is FOR, and exactly what must
		// not happen once a human has spoken.
		const filename = "unverifiable.gguf"
		await fs.writeFile(path.join(modelsDir, filename), hex("47 47 55 46"))
		await listModels()
		expect((await modelRow(filename))!.kindSource).toBe("declared")

		await setModelKind(filename, "image")

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("image")
		expect(rec!.kindSource).toBe("user")

		await listModels()
		expect((await modelRow(filename))!.kind).toBe("image")
	})
})

describe("koboldcpp:recommendedModels — the maintainer's image catalog", () => {
	const IMGMODEL_SIBLINGS = [
		{ rfilename: "imgmodel_ftuned_q4_0.gguf", size: 1_500_000_000 },
		{ rfilename: "imgmodel_xl_q4_0.gguf", size: 4_200_000_000 },
		{ rfilename: "sdxs-512-tinySDdistilled_Q8_0.gguf", size: 680_000_000 },
		{ rfilename: "README.md", size: 1_024 },
		// A multi-file Flux/SD3-class bundle — out of scope while an image load
		// passes exactly one `sdmodel`, and excluded by the root-only rule
		// rather than by a denylist of accessory names.
		{ rfilename: "z-image/z_image_turbo_q4_0.gguf", size: 3_000_000_000 },
		{ rfilename: "z-image/clip_l.safetensors", size: 200_000_000 }
	]

	const recommended = async (kind?: "text" | "image") => {
		const { koboldCppRecommendedModelsHandler } = await import(
			"./koboldcpp"
		)
		return koboldCppRecommendedModelsHandler.handler(
			socket,
			kind ? { kind } : {},
			noopEmit
		)
	}

	beforeEach(() => {
		fetchRoutes = [
			{
				match: /api\/models\/koboldcpp\/imgmodel/,
				respond: () => ({
					ok: true,
					json: async () => ({ siblings: IMGMODEL_SIBLINGS })
				})
			},
			{
				match: /recommended\.yaml/,
				respond: () => ({ ok: true, text: async () => "" })
			}
		]
	})

	// First in this block deliberately: a failed fetch must not be cached, so
	// running it before anything succeeds proves both that it returns empty and
	// that it does not poison the hour-long cache for the tests below.
	test("a failed fetch lands on the empty state rather than throwing", async () => {
		// The text path's per-model Promise.allSettled has no equivalent for a
		// single fetch; a thrown handler would take the whole tab down over an
		// HF blip.
		fetchRoutes = [
			{
				match: /api\/models\/koboldcpp\/imgmodel/,
				respond: () => ({ ok: false, status: 503 })
			}
		]

		const res = await recommended("image")

		expect(res.models).toEqual([])
	})

	test("offers every root-level model file, whatever it is called", async () => {
		// Emphatically NOT the text path's quant filter: the last
		// hyphen-separated segment of `imgmodel_xl_q4_0` is "i" and of
		// `sdxs-512-tinySDdistilled_Q8_0` is "t", so the quant regex rejects
		// every one of these and the `pullOptions.length > 0` filter downstream
		// would then hand back an empty list, with no error to explain it.
		const res = await recommended("image")

		expect(res.models.map((m) => m.pullOptions[0].filename)).toEqual([
			"imgmodel_ftuned_q4_0.gguf",
			"imgmodel_xl_q4_0.gguf",
			"sdxs-512-tinySDdistilled_Q8_0.gguf"
		])
		// ?blobs=true is required — the plain endpoint returns siblings with no
		// size, and choosing between a 680MB and a 4.2GB model with no sizes on
		// screen is not choosing.
		expect(fetchedUrls.some((u) => u.includes("blobs=true"))).toBe(true)
		expect(res.models[0].pullOptions[0].sizeBytes).toBe(1_500_000_000)
	})

	test("the cache is keyed by kind, so switching to Image does not serve the text list", async () => {
		// One module-level cache slot would hand the text list straight back for
		// an hour after the toggle moved — a bug that looks exactly like the
		// image catalog being empty, and heals just slowly enough to be
		// unreportable.
		const image = await recommended("image")
		expect(image.models.length).toBe(3)

		const text = await recommended("text")
		expect(text.models.map((m) => m.name)).not.toContain("imgmodel_xl_q4_0")

		// ...and the image list is still cached rather than refetched.
		fetchedUrls = []
		const again = await recommended("image")
		expect(again.models.length).toBe(3)
		expect(fetchedUrls.filter((u) => u.includes("imgmodel"))).toEqual([])
	})
})

describe("koboldcpp:searchModels — searching for something that draws", () => {
	const HF_RESULTS = [
		{
			id: "Pushpendra817/SDXL-Captioner-GGUF",
			pipeline_tag: "image-text-to-text",
			tags: ["gguf"],
			siblings: [{ rfilename: "SDXL-Captioner-Q4_K_M.gguf" }]
		},
		{
			id: "hum-ma/SDXL-models-GGUF",
			pipeline_tag: "text-to-image",
			tags: ["diffusers", "gguf"],
			siblings: [
				{ rfilename: "RealVisXL_V4.0-Q4_0.gguf", size: 4_000_000 }
			]
		},
		{
			id: "OlegSkutte/sdxl-turbo-GGUF",
			pipeline_tag: "text-to-image",
			tags: ["gguf", "stable-diffusion.cpp"],
			siblings: [{ rfilename: "sd_xl_turbo_1.0.q8_0.gguf" }]
		},
		{
			id: "someone/flux-bundle",
			pipeline_tag: "text-to-image",
			tags: ["gguf"],
			siblings: [{ rfilename: "clip/t5xxl.safetensors" }]
		}
	]

	const search = async (kind?: "text" | "image") => {
		const { koboldCppSearchModelsHandler } = await import("./koboldcpp")
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		loginRateLimit.clearRateLimit("koboldcpp:searchModels")
		fetchRoutes = [
			{
				match: /huggingface\.co\/api\/models\?/,
				respond: () => ({ ok: true, json: async () => HF_RESULTS })
			}
		]
		return koboldCppSearchModelsHandler.handler(
			socket,
			kind ? { searchTerm: "sdxl", kind } : { searchTerm: "sdxl" },
			noopEmit
		)
	}

	test("image mode asks Hugging Face for text-to-image as well as gguf", async () => {
		// The API ANDs repeated `filter` params — verified empirically and
		// undocumented. `&filter=gguf` alone returns vision models and untagged
		// repos, so the text query is actively wrong here.
		await search("image")
		expect(
			fetchedUrls.some(
				(u) =>
					u.includes("filter=gguf") &&
					u.includes("filter=text-to-image")
			)
		).toBe(true)
	})

	test("a vision-language model is dropped — it reads pictures, it doesn't draw them", async () => {
		const res = await search("image")
		expect(res.models.map((m) => m.name)).not.toContain(
			"Pushpendra817/SDXL-Captioner-GGUF"
		)
	})

	test("stable-diffusion.cpp repos sort first but nothing filters on the tag", async () => {
		// hum-ma/SDXL-models-GGUF is tagged `diffusers`, ships working SDXL and
		// is a top-3 result — filtering on the tag would throw away the best
		// answer to the most common search.
		const res = await search("image")
		expect(res.models.map((m) => m.name)).toEqual([
			"OlegSkutte/sdxl-turbo-GGUF",
			"hum-ma/SDXL-models-GGUF"
		])
		expect(res.models[0].sdcpp).toBe(true)
		expect(res.models[1].sdcpp).toBe(false)
	})

	test("pull options are labelled by filename, since image models carry no quant suffix", async () => {
		const res = await search("image")
		const turbo = res.models.find(
			(m) => m.name === "OlegSkutte/sdxl-turbo-GGUF"
		)!
		expect(turbo.pullOptions[0].label).toBe("sd_xl_turbo_1.0.q8_0.gguf")
	})

	test("the text path is untouched: gguf only, quant filter, no reordering", async () => {
		// The regression guard, and everything about the result is the OLD
		// behaviour: the vision-language captioner is still returned (the text
		// path never filtered pipeline tags), `sd_xl_turbo_1.0.q8_0` is still
		// dropped because "q8_0" is not the last hyphen-separated segment, and
		// nothing is re-sorted by a tag. Only the image branch is new.
		const res = await search()
		expect(
			fetchedUrls.every((u) => !u.includes("filter=text-to-image"))
		).toBe(true)
		expect(res.models.map((m) => m.name)).toEqual([
			"Pushpendra817/SDXL-Captioner-GGUF",
			"hum-ma/SDXL-models-GGUF"
		])
		expect(res.models[0].pullOptions[0].label).toBe("Q4_K_M")
	})
})
