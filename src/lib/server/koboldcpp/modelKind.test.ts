import { afterAll, beforeAll, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
	classifyGgufHeader,
	classifyModelFile,
	extensionAllowedForKind,
	isModelFilename
} from "./modelKind"

/**
 * The classifier is the load-bearing half of "the models directory now holds
 * two kinds of file". Everything downstream — which list a model appears in,
 * which model the connection form offers as a text model, whether the first-run
 * wizard thinks you own anything usable — reads the answer it writes.
 *
 * Its failures are all silent ones. An image model filed as text is offered to
 * a chat connection and dies at generation time with an error pointing at the
 * adapter; a text model filed as image is handed to `--sdmodel`, where
 * koboldcpp `exit_with_error`s and takes the text model down with it. Neither
 * shows up as a crash here, which is why these fixtures are byte-level.
 *
 * The headers below are written out field by field from real files, fetched by
 * HTTP range request rather than mocked — no test here touches the network.
 */

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex")

/**
 * magic "GGUF" | version u32-LE | tensor_count u64-LE | metadata_kv_count u64-LE.
 *
 * `tensorCountHex` participates in no rule — it is carried because it is part
 * of the observed header, not because anything reads it.
 */
function ggufHeader(tensorCountHex: string, kvCountHex: string): Buffer {
	return Buffer.concat([
		hex("47 47 55 46"), // "GGUF"
		hex("03 00 00 00"), // version 3
		hex(tensorCountHex),
		hex(kvCountHex)
	])
}

/** GGUF's length-prefixed UTF-8 string: u64-LE byte count, then the bytes. */
function gstr(s: string): Buffer {
	const bytes = Buffer.from(s, "utf8")
	const len = Buffer.alloc(8)
	len.writeBigUInt64LE(BigInt(bytes.length))
	return Buffer.concat([len, bytes])
}

/** A GGUF metadata value type tag. 8 is STRING. */
function u32(n: number): Buffer {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(n)
	return b
}

const archKv = (value: string) =>
	Buffer.concat([gstr("general.architecture"), u32(8), gstr(value)])

// --- More value types, for the KV walk that finds `<arch>.pooling_type`.

const u64 = (n: number) => {
	const b = Buffer.alloc(8)
	b.writeBigUInt64LE(BigInt(n))
	return b
}
const f32 = (n: number) => {
	const b = Buffer.alloc(4)
	b.writeFloatLE(n)
	return b
}
/** A UINT32 (type 4) KV — what `pooling_type` is written as. */
const u32Kv = (key: string, value: number) =>
	Buffer.concat([gstr(key), u32(4), u32(value)])
/** A STRING (type 8) KV. */
const strKv = (key: string, value: string) =>
	Buffer.concat([gstr(key), u32(8), gstr(value)])
/** An ARRAY (type 9) of STRING KV — `general.tags`, `tokenizer.ggml.tokens`. */
const strArrayKv = (key: string, values: string[]) =>
	Buffer.concat([
		gstr(key),
		u32(9),
		u32(8),
		u64(values.length),
		...values.map(gstr)
	])

/** A GGUF of `kvs`, its header counting them. */
function gguf(...kvs: Buffer[]): Buffer {
	return Buffer.concat([
		hex("47 47 55 46 03 00 00 00"),
		u64(112),
		u64(kvs.length),
		...kvs
	])
}

/**
 * nomic-ai/nomic-embed-text-v1.5-GGUF nomic-embed-text-v1.5.Q4_K_M.gguf, KV by
 * KV in its own order (read off the file LM Studio bundles): `pooling_type`
 * is the 11th key, at byte 470, and the tokenizer's 30 522-entry vocabulary
 * runs on past any window this file reads.
 */
const NOMIC_EMBED = gguf(
	archKv("nomic-bert"),
	strKv("general.name", "nomic-embed-text-v1.5"),
	u32Kv("nomic-bert.block_count", 12),
	u32Kv("nomic-bert.context_length", 2048),
	u32Kv("nomic-bert.embedding_length", 768),
	u32Kv("nomic-bert.feed_forward_length", 3072),
	u32Kv("nomic-bert.attention.head_count", 12),
	Buffer.concat([
		gstr("nomic-bert.attention.layer_norm_epsilon"),
		u32(6),
		f32(1e-12)
	]),
	u32Kv("general.file_type", 15),
	Buffer.concat([gstr("nomic-bert.attention.causal"), u32(7), hex("00")]),
	u32Kv("nomic-bert.pooling_type", 1),
	strKv("tokenizer.ggml.model", "bert"),
	// The vocabulary array's header, and then the window simply ends.
	Buffer.concat([gstr("tokenizer.ggml.tokens"), u32(9), u32(8), u64(30522)]),
	gstr("[PAD]")
)

const NO_KV = "00 00 00 00 00 00 00 00"

// --- SD.CPP GGUFs: zero metadata, straight into Stable-Diffusion tensor names.

/** koboldcpp/imgmodel/imgmodel_xl_q4_0.gguf — 2643 tensors, 0 KV pairs. */
const IMGMODEL_XL = Buffer.concat([
	ggufHeader("53 0a 00 00 00 00 00 00", NO_KV),
	gstr("cond_stage_model.logit_scale")
])

/** koboldcpp/imgmodel/imgmodel_ftuned_q4_0.gguf — the SD1.5-class sibling. */
const IMGMODEL_FTUNED = Buffer.concat([
	ggufHeader("53 0a 00 00 00 00 00 00", NO_KV),
	gstr(
		"cond_stage_model.transformer.text_model.embeddings.position_embedding.weight"
	)
])

/** OlegSkutte/sdxl-turbo-GGUF sd_xl_turbo_1.0.q8_0.gguf. */
const SDXL_TURBO = Buffer.concat([
	ggufHeader("53 0a 00 00 00 00 00 00", NO_KV),
	gstr("model.diffusion_model.input_blocks.0.0.bias")
])

// --- Diffusion GGUFs that DO carry metadata. The reason this file exists.

/** hum-ma/SDXL-models-GGUF RealVisXL_V4.0-Q4_0.gguf — 135 KV pairs, arch "sdxl". */
const REALVISXL = Buffer.concat([
	ggufHeader("d4 0b 00 00 00 00 00 00", "87 00 00 00 00 00 00 00"),
	archKv("sdxl")
])

/** city96/FLUX.1-dev-gguf flux1-dev-Q4_0.gguf — 3 KV pairs, arch "flux". */
const FLUX1_DEV = Buffer.concat([
	ggufHeader("c4 03 00 00 00 00 00 00", "03 00 00 00 00 00 00 00"),
	archKv("flux")
])

// --- A text LLM, written out as the raw bytes the range request returned.

/**
 * bartowski/Llama-3.2-1B-Instruct-GGUF Llama-3.2-1B-Instruct-Q4_K_M.gguf.
 *
 * Fully literal rather than composed, so at least one fixture proves the
 * decoder against bytes nothing in this file helped produce: 147 tensors, 35 KV
 * pairs, then key length 0x14, "general.architecture", value type 8, length 5,
 * "llama".
 */
const LLAMA_3_2_1B = hex(`
	47 47 55 46  03 00 00 00
	93 00 00 00  00 00 00 00
	23 00 00 00  00 00 00 00
	14 00 00 00  00 00 00 00
	67 65 6e 65 72 61 6c 2e 61 72 63 68 69 74 65 63 74 75 72 65
	08 00 00 00
	05 00 00 00  00 00 00 00
	6c 6c 61 6d 61
`)

describe("classifying a GGUF by its header", () => {
	test("an SD.CPP GGUF with no metadata KV pairs is an image model", () => {
		// Sound in exactly one direction, which is the direction being used: a
		// text GGUF cannot load without `general.architecture`, and that lives
		// in a KV pair, so zero KV pairs is certainly-not-text.
		for (const fixture of [IMGMODEL_XL, IMGMODEL_FTUNED, SDXL_TURBO]) {
			expect(classifyGgufHeader(fixture).kind).toBe("image")
		}
		expect(classifyGgufHeader(IMGMODEL_XL).reason).toMatch(/no metadata/i)
	})

	test("a diffusion model WITH metadata is still an image model", () => {
		// The case that defeats a kv-count-only rule, and the reason this test
		// exists. hum-ma/SDXL-models-GGUF ships working SDXL with 135 KV pairs
		// and general.architecture "sdxl" — and it is a top-3 result of the
		// exact Hugging Face query the image search runs, so this is the first
		// model many users will meet, not a curiosity.
		const verdict = classifyGgufHeader(REALVISXL)
		expect(verdict.kind).toBe("image")
		expect(verdict.reason).toContain("sdxl")
	})

	test("a Flux GGUF's three metadata entries do not make it text", () => {
		expect(classifyGgufHeader(FLUX1_DEV).kind).toBe("image")
	})

	test("a text LLM is read out of general.architecture", () => {
		const verdict = classifyGgufHeader(LLAMA_3_2_1B)
		expect(verdict.kind).toBe("text")
		expect(verdict.reason).toContain("llama")
	})

	test("a versioned family lands with its base name", () => {
		// The lists are prefixes precisely so llama4/gemma3/phi3/wan2.2 do not
		// each need an entry the day they ship.
		expect(classifyGgufHeader(withArch("llama4")).kind).toBe("text")
		expect(classifyGgufHeader(withArch("gemma3")).kind).toBe("text")
		expect(classifyGgufHeader(withArch("phi3")).kind).toBe("text")
		expect(classifyGgufHeader(withArch("flux1")).kind).toBe("image")
		expect(classifyGgufHeader(withArch("wan2.2")).kind).toBe("image")
	})

	test("the longer prefix wins, so qwen_image is not a Qwen chat model", () => {
		// The one place the two lists genuinely overlap. Deciding this pair by
		// which list happens to be checked first is not a reason, and would put
		// a 20B diffusion model in the text list.
		expect(classifyGgufHeader(withArch("qwen_image")).kind).toBe("image")
		expect(classifyGgufHeader(withArch("qwen2")).kind).toBe("text")
		expect(classifyGgufHeader(withArch("qwen3")).kind).toBe("text")
	})

	test("an architecture in neither list is unknown, and says which", () => {
		// The designed outcome for a brand-new architecture: visibly unsure,
		// with the override available — never a confident guess. The name is in
		// the reason because it is the first thing anyone extending the lists
		// needs to know.
		const verdict = classifyGgufHeader(withArch("some-new-thing"))
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toContain("some-new-thing")
	})

	test("general.architecture is still found when it is not the first entry", () => {
		// Writers are not obliged to put it first. The scan fallback covers
		// that without having to decode every intervening value's type.
		const buf = Buffer.concat([
			ggufHeader("01 00 00 00 00 00 00 00", "02 00 00 00 00 00 00 00"),
			gstr("general.name"),
			u32(8),
			gstr("Some Model"),
			archKv("llama")
		])
		expect(classifyGgufHeader(buf).kind).toBe("text")
	})

	test("metadata with no readable architecture is unknown, not text", () => {
		// "It has metadata so it must be an LLM" is the mirror of the kv-count
		// mistake, and just as wrong.
		const buf = Buffer.concat([
			ggufHeader("01 00 00 00 00 00 00 00", "01 00 00 00 00 00 00 00"),
			gstr("general.name"),
			u32(8),
			gstr("Some Model")
		])
		expect(classifyGgufHeader(buf).kind).toBe("unknown")
	})

	test("architectures shipping TODAY are recognised, not left unknown", () => {
		// An arch missing from LLM_ARCHS is not a cosmetic gap. 0177 backfills
		// every pre-existing row `kind_source='assumed'`, so the first scan after
		// upgrade re-sniffs them; an unrecognised arch writes `kind='unknown'`,
		// which lists the model under IMAGE as well as text — where "Use for
		// image generation" accepts it, points `sdmodel` at a text LLM, and takes
		// chat down on the next load.
		//
		// These eight all returned `unknown` before being added, and every one of
		// them is a model somebody has in their folder right now. `gpt-oss` is
		// the sharp one: the `gpt2`/`gptj`/`gptneox` prefixes do not match it.
		for (const arch of [
			"gpt-oss",
			"glm4",
			"glm4moe",
			"hunyuan-moe",
			"seed_oss",
			"ernie4_5",
			"smollm3",
			"lfm2"
		]) {
			const buf = Buffer.concat([
				ggufHeader(
					"01 00 00 00 00 00 00 00",
					"01 00 00 00 00 00 00 00"
				),
				archKv(arch)
			])
			expect(classifyGgufHeader(buf), arch).toMatchObject({
				kind: "text"
			})
		}
	})

	test("the diffusion side still wins where the two could collide", () => {
		// `qwen_image` is a diffusion model and `qwen2`/`qwen3` are LLMs; adding
		// LLM names must not start swallowing image arches by prefix.
		const img = Buffer.concat([
			ggufHeader("01 00 00 00 00 00 00 00", "01 00 00 00 00 00 00 00"),
			archKv("qwen_image")
		])
		expect(classifyGgufHeader(img).kind).toBe("image")
	})
})

describe("telling an embedding model apart", () => {
	// B1 (2026-10-05). koboldcpp loads an embedding GGUF into a slot of its
	// own, beside the chat model; filed as `text`, it was offered for chat and
	// "Use for chat" pointed `--model` at it.

	test("a real embedding GGUF's pooling key makes it embeddings", () => {
		const verdict = classifyGgufHeader(NOMIC_EMBED)
		expect(verdict.kind).toBe("embeddings")
		expect(verdict.reason).toContain("nomic-bert.pooling_type")
		expect(verdict.reason).toContain("(mean)")
	})

	test("the pooling key decides, not the architecture: qwen3 can be either", () => {
		// Qwen3-Embedding ships as arch `qwen3`, exactly as the Qwen3 chat
		// models do — the case an architecture list cannot get right.
		const embedding = gguf(
			archKv("qwen3"),
			strArrayKv("general.tags", ["sentence-transformers", "embeddings"]),
			u32Kv("qwen3.context_length", 32768),
			u32Kv("qwen3.pooling_type", 3)
		)
		expect(classifyGgufHeader(embedding)).toMatchObject({
			kind: "embeddings",
			reason: expect.stringContaining("(last)")
		})
		const chat = gguf(
			archKv("qwen3"),
			u32Kv("qwen3.context_length", 40960),
			strKv("tokenizer.ggml.model", "gpt2")
		)
		expect(classifyGgufHeader(chat).kind).toBe("text")
	})

	test("every embedding pooling counts, written as any integer type", () => {
		for (const pooling of [0, 1, 2, 3]) {
			expect(
				classifyGgufHeader(
					gguf(archKv("bert"), u32Kv("bert.pooling_type", pooling))
				).kind,
				`pooling ${pooling}`
			).toBe("embeddings")
		}
		// INT32 (type 5) rather than UINT32: the enum is signed in llama.cpp.
		const int32 = gguf(
			archKv("qwen3"),
			Buffer.concat([gstr("qwen3.pooling_type"), u32(5), u32(2)])
		)
		expect(classifyGgufHeader(int32).kind).toBe("embeddings")
	})

	test("a reranker is not an embedding model, and says so", () => {
		// `rank` pooling (4): bge-reranker, Qwen3-Reranker. It scores a passage
		// against a query; the embeddings slot would load it and answer garbage.
		const verdict = classifyGgufHeader(
			gguf(archKv("qwen3"), u32Kv("qwen3.pooling_type", 4))
		)
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toMatch(/reranker/)
	})

	test("a pooling type nobody has defined is unknown, and names it", () => {
		const verdict = classifyGgufHeader(
			gguf(archKv("qwen3"), u32Kv("qwen3.pooling_type", 9))
		)
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toContain("9")
	})

	test("another architecture's pooling key is not this file's", () => {
		const verdict = classifyGgufHeader(
			gguf(archKv("llama"), u32Kv("bert.pooling_type", 1))
		)
		expect(verdict.kind).toBe("text")
	})

	test("without a pooling key, an embedding-only architecture still lands", () => {
		// The fallback: an older conversion with no pooling key. `bert` was in
		// the LANGUAGE-model list until B1, which filed every BGE and MiniLM
		// GGUF as a chat model.
		expect(classifyGgufHeader(withArch("bert")).kind).toBe("embeddings")
		expect(classifyGgufHeader(withArch("nomic-bert-moe")).kind).toBe(
			"embeddings"
		)
		expect(classifyGgufHeader(withArch("jina-bert-v2")).kind).toBe(
			"embeddings"
		)
		// The longer prefix wins over `gemma`, as qwen_image does over `qwen`.
		expect(classifyGgufHeader(withArch("gemma-embedding")).kind).toBe(
			"embeddings"
		)
		expect(classifyGgufHeader(withArch("gemma3")).kind).toBe("text")
	})

	test("a pooling key past a value the walk cannot decode is not guessed at", () => {
		// An unknown value type (99) ends the walk; the architecture, found by
		// the scan fallback, decides — never a throw.
		const buf = gguf(
			archKv("qwen3"),
			Buffer.concat([gstr("odd.key"), u32(99), u32(0)]),
			u32Kv("qwen3.pooling_type", 1)
		)
		expect(() => classifyGgufHeader(buf)).not.toThrow()
		expect(classifyGgufHeader(buf).kind).toBe("text")
	})

	test("a header cut off inside the pooling value falls back to the architecture", () => {
		const whole = gguf(archKv("bert"), u32Kv("bert.pooling_type", 4))
		const cut = whole.subarray(0, whole.length - 2)
		expect(() => classifyGgufHeader(cut)).not.toThrow()
		// Without the key, `bert` is an embedding-only architecture.
		expect(classifyGgufHeader(cut).kind).toBe("embeddings")
	})
})

describe("headers that are not headers", () => {
	// Every one of these is reachable in the models directory: a download that
	// died halfway, a README somebody renamed, a zero-byte placeholder. None of
	// them may throw — a listing that fails takes the whole managed KoboldCPP down with
	// it, which is a much worse outcome than one row reading "Unverified".

	test("a truncated file is unknown rather than a decode error", () => {
		const verdict = classifyGgufHeader(hex("47 47 55 46 03 00 00 00"))
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toMatch(/shorter than/i)
	})

	test("an empty buffer is unknown", () => {
		expect(classifyGgufHeader(Buffer.alloc(0)).kind).toBe("unknown")
	})

	test("a non-GGUF file is unknown", () => {
		const verdict = classifyGgufHeader(
			Buffer.from("This is a plain text file, not a model at all.\n")
		)
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toMatch(/magic/i)
	})

	test("an unreadable GGUF version is unknown rather than a guess", () => {
		const buf = Buffer.concat([
			hex("47 47 55 46  01 00 00 00"),
			hex("01 00 00 00 00 00 00 00"),
			hex("00 00 00 00 00 00 00 00")
		])
		const verdict = classifyGgufHeader(buf)
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toContain("version 1")
	})

	test("a length field pointing past the end of the window does not throw", () => {
		// A garbage u64 length is exactly what a half-written header looks like,
		// and readBigUInt64LE/toString on a short buffer is where a naive
		// decoder throws.
		const buf = Buffer.concat([
			ggufHeader("01 00 00 00 00 00 00 00", "01 00 00 00 00 00 00 00"),
			hex("ff ff ff ff ff ff ff 7f") // key length: 2^63-ish
		])
		expect(() => classifyGgufHeader(buf)).not.toThrow()
		expect(classifyGgufHeader(buf).kind).toBe("unknown")
	})
})

describe("classifying by extension", () => {
	test("a .safetensors can only be an image model, with no file read", async () => {
		// koboldcpp loads text models from GGUF only, so in THIS directory the
		// extension really is decisive — the one place it is.
		const verdict = await classifyModelFile(
			"/nonexistent/vae-fix.safetensors"
		)
		expect(verdict.kind).toBe("image")
	})

	test("the extension rule is asymmetric, because koboldcpp is", () => {
		expect(extensionAllowedForKind("model-Q4_K_M.gguf", "text")).toBe(true)
		expect(extensionAllowedForKind("model-Q4_K_M.gguf", "image")).toBe(true)
		// A .safetensors arriving from the text tab is a download that could
		// never have loaded.
		expect(extensionAllowedForKind("sd_xl_base.safetensors", "text")).toBe(
			false
		)
		expect(extensionAllowedForKind("sd_xl_base.safetensors", "image")).toBe(
			true
		)
		expect(extensionAllowedForKind("model.ckpt", "image")).toBe(false)
	})

	test("only .gguf and .safetensors count as model files at all", () => {
		// The directory scan's filter. `.ckpt` is deliberately out: koboldcpp
		// does not accept it, so listing one would offer a model that cannot
		// load.
		expect(isModelFilename("imgmodel_xl_q4_0.gguf")).toBe(true)
		expect(isModelFilename("sd_xl_base_1.0.SAFETENSORS")).toBe(true)
		expect(isModelFilename("v1-5-pruned.ckpt")).toBe(false)
		expect(isModelFilename("README.md")).toBe(false)
	})
})

describe("reading a real file off disk", () => {
	let dir: string

	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-model-kind-"))
	})

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	test("a file on disk is classified from its first bytes", async () => {
		const file = path.join(dir, "Llama-3.2-1B-Instruct-Q4_K_M.gguf")
		// Padded well past the 64 KiB window so this exercises a positional read
		// of a prefix rather than a whole-file slurp.
		await fs.writeFile(
			file,
			Buffer.concat([LLAMA_3_2_1B, Buffer.alloc(200_000)])
		)
		expect((await classifyModelFile(file)).kind).toBe("text")

		const sd = path.join(dir, "imgmodel_xl_q4_0.gguf")
		await fs.writeFile(
			sd,
			Buffer.concat([IMGMODEL_XL, Buffer.alloc(200_000)])
		)
		expect((await classifyModelFile(sd)).kind).toBe("image")
	})

	test("a pooling key past the first 4 KiB is still read", async () => {
		// A quantizer's description, tags and base-model list ahead of the
		// model's own keys. The window was 4 KiB until B1; at that size this
		// Qwen3-Embedding listed as a chat model.
		const file = path.join(dir, "Qwen3-Embedding-0.6B-Q8_0.gguf")
		await fs.writeFile(
			file,
			Buffer.concat([
				gguf(
					archKv("qwen3"),
					strKv("general.description", "x".repeat(6000)),
					strArrayKv(
						"general.tags",
						Array.from({ length: 50 }, (_, i) => `tag-${i}`)
					),
					u32Kv("qwen3.pooling_type", 3)
				),
				Buffer.alloc(200_000)
			])
		)
		expect((await classifyModelFile(file)).kind).toBe("embeddings")

		const nomic = path.join(dir, "nomic-embed-text-v1.5.Q4_K_M.gguf")
		await fs.writeFile(
			nomic,
			Buffer.concat([NOMIC_EMBED, Buffer.alloc(200_000)])
		)
		expect((await classifyModelFile(nomic)).kind).toBe("embeddings")
	})

	test("a file that vanished mid-scan is unknown, not a thrown listing", async () => {
		// The race the models-directory scan actually runs into: a row is read,
		// the user deletes the file, the sniff arrives second.
		const verdict = await classifyModelFile(path.join(dir, "gone.gguf"))
		expect(verdict.kind).toBe("unknown")
		expect(verdict.reason).toContain("ENOENT")
	})

	test("a file with an extension koboldcpp cannot load is unknown", async () => {
		expect(
			(await classifyModelFile(path.join(dir, "notes.txt"))).kind
		).toBe("unknown")
	})
})

/** A minimal one-KV GGUF carrying just `general.architecture`. */
function withArch(architecture: string): Buffer {
	return Buffer.concat([
		ggufHeader("01 00 00 00 00 00 00 00", "01 00 00 00 00 00 00 00"),
		archKv(architecture)
	])
}
