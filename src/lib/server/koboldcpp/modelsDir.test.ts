/**
 * Two models directories, and the ways a second one could go wrong.
 *
 * Every property here fails SILENTLY if it regresses: a traversal that resolves
 * somewhere plausible, a legacy install whose image models stop being found, a
 * download that lands in the folder the user was not looking at. Run against a
 * real temp filesystem rather than a mocked `fs`, because "is the file there"
 * is the whole question the read path asks.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as fsPromises from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	assertBareFilename,
	modelsDirFor,
	modelsDirsToScan,
	resolveModelPath
} from "./modelsDir"

let root: string
let textDir: string
let imageDir: string

/** Both directories configured, the shape a fresh install gets. */
let split: {
	koboldCppManagerModelsDir: string
	koboldCppImageModelsDir: string
}
/** One flat directory, the shape every upgraded install keeps. */
let flat: {
	koboldCppManagerModelsDir: string
	koboldCppImageModelsDir: null
}

beforeAll(async () => {
	root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sp-modelsdir-"))
	textDir = path.join(root, "llm")
	imageDir = path.join(root, "image")
	await fsPromises.mkdir(textDir)
	await fsPromises.mkdir(imageDir)
	await fsPromises.writeFile(path.join(textDir, "llama.gguf"), "x")
	await fsPromises.writeFile(path.join(imageDir, "sdxl.safetensors"), "x")
	// The legacy case: an image model the user downloaded before there were two
	// directories, still sitting in the LLM folder.
	await fsPromises.writeFile(path.join(textDir, "legacy-sd.gguf"), "x")
	split = {
		koboldCppManagerModelsDir: textDir,
		koboldCppImageModelsDir: imageDir
	}
	flat = { koboldCppManagerModelsDir: textDir, koboldCppImageModelsDir: null }
})

afterAll(async () => {
	await fsPromises.rm(root, { recursive: true, force: true })
})

describe("modelsDirFor", () => {
	test("an unset image directory resolves to the text one, for reads AND writes", () => {
		// NULL is the upgrade contract, not a missing value: an install with one
		// flat folder must keep finding every model it already owns.
		expect(modelsDirFor("image", flat)).toBe(textDir)
		expect(modelsDirFor("text", flat)).toBe(textDir)
	})

	test("a set image directory is used for image and never for text", () => {
		expect(modelsDirFor("image", split)).toBe(imageDir)
		expect(modelsDirFor("text", split)).toBe(textDir)
	})

	test("nothing configured at all is null rather than a guessed path", () => {
		expect(
			modelsDirFor("image", {
				koboldCppManagerModelsDir: null,
				koboldCppImageModelsDir: null
			})
		).toBeNull()
	})
})

describe("assertBareFilename", () => {
	// The precondition that makes containment defence in depth rather than the
	// only line: a name is rejected BEFORE any directory is joined to it, so
	// there is nothing left for the resolve step to have to catch.
	test.each([
		["../escape.gguf"],
		["sub/dir.gguf"],
		["..\\windows-shaped.gguf"],
		["/absolute/path.gguf"],
		[".."],
		["."],
		[""]
	])("refuses %j", (name) => {
		expect(() => assertBareFilename(name)).toThrow(/Invalid model filename/)
	})

	test("accepts an ordinary filename", () => {
		expect(() => assertBareFilename("llama.gguf")).not.toThrow()
	})
})

describe("resolveModelPath", () => {
	test("a traversal name is refused before any directory is joined", async () => {
		// Not "resolves outside and then gets caught" — refused outright, so the
		// containment check never has to be the thing that saves us.
		await expect(
			resolveModelPath("image", "../llm/llama.gguf", split, {
				mustExist: true
			})
		).rejects.toThrow(/Invalid model filename/)
	})

	test("a name cannot escape its own directory by being classified as the other kind", async () => {
		// The specific hole a widened "under EITHER directory" check would open:
		// `../image/x` resolved against the TEXT directory lands inside the image
		// one and would pass. Containment is a property of the PAIR.
		await expect(
			resolveModelPath("text", "../image/sdxl.safetensors", split, {
				mustExist: true
			})
		).rejects.toThrow(/Invalid model filename/)
	})

	test("finds a model in its own kind's directory", async () => {
		await expect(
			resolveModelPath("image", "sdxl.safetensors", split, {
				mustExist: true
			})
		).resolves.toBe(path.join(imageDir, "sdxl.safetensors"))
	})

	test("a file in the legacy flat directory still resolves for the image kind", async () => {
		// The whole reason nothing moves on disk. An image model downloaded
		// before there were two directories is still in models/llm, and it has to
		// keep loading — and keep being deletable — with no migration.
		await expect(
			resolveModelPath("image", "legacy-sd.gguf", split, {
				mustExist: true
			})
		).resolves.toBe(path.join(textDir, "legacy-sd.gguf"))
	})

	test("the retry runs the containment check again against the other directory", async () => {
		// The retry is a whole fresh (dir, filename) pair, so the name is still a
		// bare filename by the time the second directory sees it.
		await expect(
			resolveModelPath("image", "../llm/legacy-sd.gguf", split, {
				mustExist: true
			})
		).rejects.toThrow(/Invalid model filename/)
	})

	test("a read that finds nothing anywhere names the file it was looking for", async () => {
		await expect(
			resolveModelPath("image", "never-existed.gguf", split, {
				mustExist: true
			})
		).rejects.toThrow(/never-existed\.gguf/)
	})

	test("a WRITE never falls back to the other directory", async () => {
		// A download of a name that happens to exist in the text folder must
		// still land in the image folder — falling back would scatter new files
		// into whichever directory answered first.
		await expect(
			resolveModelPath("image", "legacy-sd.gguf", split, {
				mustExist: false
			})
		).resolves.toBe(path.join(imageDir, "legacy-sd.gguf"))
	})

	test("a WRITE is still contained", async () => {
		await expect(
			resolveModelPath("image", "../llm/whatever.gguf", split, {
				mustExist: false
			})
		).rejects.toThrow(/Invalid model filename/)
	})

	test("a write with no directory configured for that kind refuses rather than writing to the cwd", async () => {
		await expect(
			resolveModelPath(
				"text",
				"llama.gguf",
				{ koboldCppManagerModelsDir: null },
				{ mustExist: false }
			)
		).rejects.toThrow(/models directory is configured/)
	})
})

describe("modelsDirsToScan", () => {
	test("a flat install produces exactly one directory, so nothing about it changes", () => {
		// Two entries resolving to the same string would make the listing scan
		// read it twice and — far worse — makes it tempting to sweep between them.
		expect(modelsDirsToScan(flat)).toEqual([{ kind: "text", dir: textDir }])
	})

	test("a split install produces both, text first", () => {
		expect(modelsDirsToScan(split)).toEqual([
			{ kind: "text", dir: textDir },
			{ kind: "image", dir: imageDir }
		])
	})

	test("deduplicates when the two columns hold the same path spelled differently", () => {
		expect(
			modelsDirsToScan({
				koboldCppManagerModelsDir: textDir,
				koboldCppImageModelsDir: path.join(textDir, "..", "llm")
			})
		).toEqual([{ kind: "text", dir: textDir }])
	})

	test("nothing configured scans nothing", () => {
		expect(
			modelsDirsToScan({
				koboldCppManagerModelsDir: null,
				koboldCppImageModelsDir: null
			})
		).toEqual([])
	})
})
