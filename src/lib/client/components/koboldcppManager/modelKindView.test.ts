import { describe, it, expect } from "vitest"
import {
	countTextModels,
	imageModelStatus,
	isCurrentlyLoaded,
	isListedUnder,
	modelDisplayName,
	modelsDirForKind,
	textModelOptions
} from "./modelKindView"

/**
 * Every rule in modelKindView fails without an exception: the list quietly
 * omits a row, the header quietly claims image generation is live, the count
 * quietly stops driving the first-run cue. Nothing here can be caught by
 * "it rendered", so it is all asserted directly.
 */

function model(kind: Sockets.KoboldCPP.ModelKind) {
	return { kind }
}

describe("isListedUnder", () => {
	it("shows a text model only in the text list", () => {
		expect(isListedUnder("text", "text")).toBe(true)
		expect(isListedUnder("text", "image")).toBe(false)
	})

	it("shows an image model only in the image list", () => {
		expect(isListedUnder("image", "image")).toBe(true)
		expect(isListedUnder("image", "text")).toBe(false)
	})

	// The property that matters most, and the one a "tidy" refactor is most
	// likely to break: a file the classifier could not read still has to be
	// reachable from somewhere. If it falls out of both lists it is invisible
	// in the app while plainly present on disk, which reads as the directory
	// scan being broken — and the Unverified override is then unreachable, so
	// the user has no way to correct it either.
	it("shows an unverified model in BOTH lists, so no file can become invisible", () => {
		expect(isListedUnder("unknown", "text")).toBe(true)
		expect(isListedUnder("unknown", "image")).toBe(true)
	})
})

describe("countTextModels", () => {
	// This count is the first-run wizard's "you have nothing usable" signal.
	// Counting every row instead loses the glow for the one user who most
	// needs it: the one whose only model is an SD checkpoint.
	it("ignores image models, so a user holding only an image model still counts as empty", () => {
		expect(countTextModels([model("image")])).toBe(0)
		expect(countTextModels([model("image"), model("image")])).toBe(0)
	})

	it("counts unverified models, matching exactly what the text list renders", () => {
		expect(countTextModels([model("unknown")])).toBe(1)
	})

	it("counts text models", () => {
		expect(
			countTextModels([model("text"), model("image"), model("text")])
		).toBe(2)
	})
})

describe("textModelOptions", () => {
	const llm = { name: "llama.gguf", kind: "text" as const }
	const sd = { name: "sdxl.safetensors", kind: "image" as const }
	const mystery = { name: "mystery.gguf", kind: "unknown" as const }

	it("keeps an image model out of a connection's text-model picker", () => {
		const { options } = textModelOptions([llm, sd], "llama.gguf")
		expect(options.map((m) => m.name)).toEqual(["llama.gguf"])
	})

	it("still offers unverified models, so an unreadable file isn't unusable", () => {
		const { options } = textModelOptions([llm, mystery], null)
		expect(options.map((m) => m.name)).toEqual([
			"llama.gguf",
			"mystery.gguf"
		])
	})

	// The dangerous one. A <select> bound to a value with no matching <option>
	// renders BLANK, and this form writes its state back into the connection —
	// so filtering the stored selection out would silently clear the model on
	// the next save. The user would lose it just by opening the form.
	it("keeps a stored selection that has since been classified as an image model", () => {
		const { options, selectedIsImageModel } = textModelOptions(
			[llm, sd],
			"sdxl.safetensors"
		)
		expect(selectedIsImageModel).toBe(true)
		expect(options.map((m) => m.name)).toContain("sdxl.safetensors")
	})

	it("does not flag a normal text selection as an image model", () => {
		expect(
			textModelOptions([llm, sd], "llama.gguf").selectedIsImageModel
		).toBe(false)
		expect(textModelOptions([llm, sd], null).selectedIsImageModel).toBe(
			false
		)
	})

	// A connection pointing at a file that is no longer on disk is a different
	// problem with a different fix; it must not be mistaken for the image case
	// and given a warning about the wrong thing.
	it("does not flag a selection that isn't in the list at all", () => {
		expect(
			textModelOptions([llm], "deleted.gguf").selectedIsImageModel
		).toBe(false)
	})
})

describe("modelDisplayName", () => {
	it("strips .safetensors as well as .gguf, since image models arrive as both", () => {
		expect(modelDisplayName("sd_xl_base_1.0.safetensors")).toBe(
			"sd_xl_base_1.0"
		)
		expect(modelDisplayName("imgmodel_xl_q4_0.gguf")).toBe(
			"imgmodel_xl_q4_0"
		)
		expect(modelDisplayName("SD_XL_BASE.SAFETENSORS")).toBe("SD_XL_BASE")
	})

	it("leaves a name with no known extension alone", () => {
		expect(modelDisplayName("weirdfile")).toBe("weirdfile")
	})

	// Only the trailing extension goes. A model whose name contains ".gguf"
	// mid-string is rare but a global replace would mangle it beyond
	// recognition, and the user would be looking for a file that appears not
	// to exist.
	it("only strips a TRAILING extension", () => {
		expect(modelDisplayName("my.gguf.backup")).toBe("my.gguf.backup")
	})
})

describe("isCurrentlyLoaded", () => {
	it("matches on the display name, since koboldcpp reports its own label rather than the filename", () => {
		expect(
			isCurrentlyLoaded("Imgmodel_Xl_Q4_0", "imgmodel_xl_q4_0.gguf")
		).toBe(true)
	})

	it("matches a .safetensors model, which the old .gguf-only strip could not", () => {
		expect(
			isCurrentlyLoaded("sd_xl_base_1.0", "sd_xl_base_1.0.safetensors")
		).toBe(true)
	})

	it("is false when nothing is loaded", () => {
		expect(isCurrentlyLoaded(null, "anything.gguf")).toBe(false)
		expect(isCurrentlyLoaded("", "anything.gguf")).toBe(false)
	})
})

describe("imageModelStatus", () => {
	/** The image half of the loaded-config residency map. */
	function resident(file: string) {
		return { file }
	}

	it("is off when no image model is connected", () => {
		expect(imageModelStatus(null, null)).toBe("off")
		expect(imageModelStatus(undefined, resident("sd.gguf"))).toBe("off")
		// An empty string is the shape a cleared value can take on its way
		// through a form; it means the same thing as null and must not read as
		// "connected".
		expect(imageModelStatus("", null)).toBe("off")
	})

	// The state the whole three-way header exists for, and it is now the
	// ORDINARY one: connecting an image model does not load it, and while the
	// user is chatting the process is holding the text model instead. Collapsed
	// into "off" or "active" this reads as a broken setup on every visit.
	it("is pending when a model is connected but no image model is resident", () => {
		expect(imageModelStatus("sd.gguf", null)).toBe("pending")
		expect(imageModelStatus("sd.gguf", undefined)).toBe("pending")
	})

	it("is pending when the running process holds a DIFFERENT image model", () => {
		expect(imageModelStatus("sd.gguf", resident("previous.gguf"))).toBe(
			"pending"
		)
	})

	it("is active when the resident image model is the connected one", () => {
		expect(imageModelStatus("sd.gguf", resident("sd.gguf"))).toBe("active")
	})

	// A connection stores a bare filename; the residency record echoes back
	// what went into the .kcpps, which can be that filename joined against a
	// models directory. Comparing them raw reports "pending" forever — the
	// header never reaches Active no matter how long the user waits.
	it("is active when the resident path is the connected file joined against a models dir", () => {
		expect(
			imageModelStatus("sd.gguf", resident("/home/u/models/sd.gguf"))
		).toBe("active")
		expect(
			imageModelStatus(
				"sd.gguf",
				resident("C:\\Users\\u\\models\\sd.gguf")
			)
		).toBe("active")
	})

	it("compares case-insensitively, since the path round-trips through the host filesystem", () => {
		expect(imageModelStatus("SD.gguf", resident("/models/sd.gguf"))).toBe(
			"active"
		)
	})
})

describe("modelsDirForKind", () => {
	const both = {
		koboldCppManagerModelsDir: "/data/models/llm",
		koboldCppImageModelsDir: "/data/models/image"
	}

	it("gives each kind its own directory once both are set", () => {
		expect(modelsDirForKind("text", both)).toBe("/data/models/llm")
		expect(modelsDirForKind("image", both)).toBe("/data/models/image")
	})

	// The upgrade contract, and the one that fails silently: every install that
	// exists today has exactly one directory. Reading NULL as "no directory"
	// would have the Image tab report nothing configured and hide models the
	// user can see sitting in their folder.
	it("falls back to the text directory when the image one is unset", () => {
		expect(
			modelsDirForKind("image", {
				koboldCppManagerModelsDir: "/data/models/llm",
				koboldCppImageModelsDir: null
			})
		).toBe("/data/models/llm")
		expect(
			modelsDirForKind("image", {
				koboldCppManagerModelsDir: "/data/models/llm"
			})
		).toBe("/data/models/llm")
	})

	// A blank field is what a user who clears the input actually saves, and it
	// has to mean the same thing as never having set one.
	it("treats an empty string as unset in both directions", () => {
		expect(
			modelsDirForKind("image", {
				koboldCppManagerModelsDir: "/data/models/llm",
				koboldCppImageModelsDir: ""
			})
		).toBe("/data/models/llm")
		expect(
			modelsDirForKind("text", { koboldCppManagerModelsDir: "" })
		).toBeNull()
	})

	// The image directory never stands in for the text one: a text model has
	// no business being looked for in the image folder, and reporting one
	// configured would replace "set a Models Directory" with an empty list.
	it("does not let the image directory answer for the text kind", () => {
		expect(
			modelsDirForKind("text", {
				koboldCppManagerModelsDir: null,
				koboldCppImageModelsDir: "/data/models/image"
			})
		).toBeNull()
	})

	it("is null for both kinds when nothing is configured", () => {
		expect(modelsDirForKind("text", null)).toBeNull()
		expect(modelsDirForKind("image", undefined)).toBeNull()
		expect(modelsDirForKind("image", {})).toBeNull()
	})
})
