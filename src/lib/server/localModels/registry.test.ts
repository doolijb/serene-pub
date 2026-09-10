/**
 * The derivations that replace an `engine` column.
 *
 * A `.gguf` is not owned by KoboldCPP — llama.cpp opens the same bytes — so a
 * stored engine per row would assert an exclusivity that does not exist and
 * would need rewriting the day a backend is added. These functions are what a
 * row is asked instead, so the two asymmetries they encode are pinned here
 * rather than left to be rediscovered at a call site.
 */

import { describe, it, expect } from "vitest"
import {
	enginesFor,
	formatForFilename,
	modalityForKind
} from "./registry"

describe("formatForFilename", () => {
	it("reads the container off the name, case-insensitively", () => {
		expect(formatForFilename("Llama-3.2-3B-Q4_K_M.gguf")).toBe("gguf")
		expect(formatForFilename("sd_xl_base_1.0.SAFETENSORS")).toBe(
			"safetensors"
		)
		expect(formatForFilename("all-MiniLM-L6-v2.onnx")).toBe("onnx")
	})

	it("answers null rather than guessing at a name it does not know", () => {
		// The scan gates on `isModelFilename` long before this is asked, so
		// reaching null means a caller got a name from somewhere else — and the
		// column's 'gguf' default is exactly the guess `format` exists to stop
		// anything making.
		expect(formatForFilename("notes.txt")).toBeNull()
		expect(formatForFilename("gguf")).toBeNull()
		expect(formatForFilename("")).toBeNull()
	})

	it("is not fooled by the format appearing anywhere but the end", () => {
		// The case that makes this more than pedantry: a partial download is a
		// real thing to find in a models directory, and it is not loadable. A
		// substring match would call `model.safetensors.part` a safetensors and
		// hand it to koboldcpp.
		expect(formatForFilename("sd_xl_base.safetensors.part")).toBeNull()
		expect(formatForFilename("Llama-3.2-3B.gguf.tmp")).toBeNull()
		expect(formatForFilename("gguf-converted-model.bin")).toBeNull()
		expect(formatForFilename("onnx/all-MiniLM.gguf")).toBe("gguf")
	})
})

describe("enginesFor", () => {
	it("keeps koboldcpp's text side GGUF-only", () => {
		// The same asymmetry `extensionAllowedForKind` enforces on the download
		// path: koboldcpp loads GGUF only for text, GGUF *or* safetensors for
		// images. A .safetensors offered as a text model is a download that
		// could never have worked.
		expect(enginesFor("safetensors", "text-gen")).toEqual([])
		expect(enginesFor("safetensors", "image-gen")).toEqual(["koboldcpp"])
		expect(enginesFor("gguf", "text-gen")).toContain("koboldcpp")
	})

	it("gives image-gen to koboldcpp alone, because sd.cpp is what it adds", () => {
		expect(enginesFor("gguf", "image-gen")).toEqual(["koboldcpp"])
	})

	it("keeps the GGUF and ONNX lanes disjoint", () => {
		// Nothing that speaks GGUF reads ONNX, and the reverse. Worth pinning
		// because the embedding lane arrives as ONNX and the temptation is to
		// let the existing loader answer for it.
		expect(enginesFor("onnx", "embeddings")).toEqual(["onnx"])
		expect(enginesFor("gguf", "ner")).toEqual([])
		expect(enginesFor("onnx", "text-gen")).toEqual([])
		expect(enginesFor("onnx", "image-gen")).toEqual([])
	})

	it("treats an unknown modality as 'no engine', not as 'any engine'", () => {
		// A role nothing here supports is not a reason to hand back a loader
		// that would fail at load time with nothing on screen.
		expect(enginesFor("gguf", "tts")).toEqual([])
		expect(enginesFor("safetensors", "embeddings")).toEqual([])
	})

	it("treats a null modality as the union of the roles the format has", () => {
		// The row's honest "nobody knows yet". "We cannot say what this is for"
		// is a different claim from "nothing can load it", so the answer is
		// every engine the container is loadable by at all.
		expect(enginesFor("gguf", null)).toEqual(["koboldcpp", "llamacpp"])
		expect(enginesFor("safetensors", null)).toEqual(["koboldcpp"])
		expect(enginesFor("onnx", null)).toEqual(["onnx"])
		expect(enginesFor("gguf", undefined)).toEqual(
			enginesFor("gguf", null)
		)
	})

	it("names llamacpp for the GGUF text lane it genuinely shares", () => {
		// The point of deriving rather than storing: the same file answers for
		// more than one backend, so no row may claim one of them exclusively.
		expect(enginesFor("gguf", "text-gen")).toEqual([
			"koboldcpp",
			"llamacpp"
		])
		expect(enginesFor("gguf", "embeddings")).toEqual([
			"koboldcpp",
			"llamacpp"
		])
	})
})

describe("modalityForKind", () => {
	it("projects the two decided kinds", () => {
		expect(modalityForKind("text")).toBe("text-gen")
		expect(modalityForKind("image")).toBe("image-gen")
	})

	it("gives 'unknown' no modality at all", () => {
		// ⚠ Not "text-gen". The classifier reaching `unknown` means it looked
		// and could not tell; a role written here would turn "we do not know"
		// into an assertion, and `kind_source` would then grade that assertion
		// as though something had measured it.
		expect(modalityForKind("unknown")).toBeNull()
	})
})
