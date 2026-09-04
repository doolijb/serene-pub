/**
 * The capability↔shape correspondence, and the asymmetry between its two
 * directions.
 *
 * The failure this guards is the one that already happened once: a second copy
 * of the mapping, written as `s === S.imageGen ? "text->image" : "text->text"`,
 * read a TTS config's default out of the CHAT capability because everything
 * that is not image fell into the else. Nothing threw. The star simply moved
 * the wrong row.
 */

import { describe, expect, test } from "vitest"
import { S, SAMPLING_SCHEMAS, TRANSFORMS } from "@serene-pub/sdk"
import {
	capabilityForSamplingShape,
	outputKindOf,
	samplingShapeForCapability
} from "./samplingShape"

describe("outputKindOf", () => {
	test("it reads the output side, not the input", () => {
		expect(outputKindOf("text->image")).toBe("image")
		expect(outputKindOf("text+image->text")).toBe("text")
		expect(outputKindOf("image->image")).toBe("image")
		expect(outputKindOf("audio->text")).toBe("text")
	})

	test("a transform this build never heard of still files itself", () => {
		// Derived through `parseTransform`, so a plugin's own combo gets a
		// heading rather than landing in "Other" forever. A list of hardcoded
		// comparisons is what this replaces.
		expect(outputKindOf("text->video")).toBe("video")
		expect(outputKindOf("audio->audio")).toBe("audio")
	})

	test("a multi-kind output side is undefined, not its first kind", () => {
		// Naming the first would hand image samplers to something that mostly
		// writes prose, and the group heading would say a thing that is half
		// false. Undefined is the honest answer and costs nothing today.
		expect(outputKindOf("text->text+image")).toBeUndefined()
	})

	test("a feature id has no output", () => {
		expect(outputKindOf("json_schema")).toBeUndefined()
		expect(outputKindOf("tools")).toBeUndefined()
	})
})

describe("samplingShapeForCapability", () => {
	test("the three image transforms all reach the image samplers", () => {
		// The fan-out this exists for. `TRANSFORMS` names three of them, they
		// share one steps/CFG/sampler vocabulary, and a star that wrote only
		// `text->image` would leave a control labelled "the image default"
		// moving one of three rows.
		for (const id of ["text->image", "text+image->image", "image->image"])
			expect(samplingShapeForCapability(id)).toBe(S.imageGen)
	})

	test("every text-producing transform reaches the text samplers", () => {
		for (const id of ["text->text", "text+image->text", "audio->text"])
			expect(samplingShapeForCapability(id)).toBe(S.textGen)
	})

	test("speech reaches the TTS samplers, not the text ones", () => {
		expect(samplingShapeForCapability("text->audio")).toBe(S.tts)
	})

	test("a capability with no vocabulary answers undefined", () => {
		// Not `S.textGen`. Embeddings take no parameters, and answering "text"
		// would hand a temperature to a backend that has never heard of one.
		expect(samplingShapeForCapability("text->embedding")).toBeUndefined()
		expect(samplingShapeForCapability("text->video")).toBeUndefined()
	})

	test("every shape it can name has a vocabulary in the SDK", () => {
		// The screen renders a picker whenever this answers. If it could name a
		// shape `SAMPLING_SCHEMAS` does not know, the picker would offer configs
		// whose values can never be sent.
		for (const id of Object.keys(TRANSFORMS)) {
			const shape = samplingShapeForCapability(id)
			if (shape) expect(SAMPLING_SCHEMAS[shape]).toBeDefined()
		}
	})
})

describe("the two directions", () => {
	test("shape → capability → shape is the identity on all three shapes", () => {
		// This direction IS total, and is what the fan-out depends on: whatever
		// `capabilityForSamplingShape` names as a shape's representative has to
		// map back to that shape, or a starred config would register against a
		// capability the screen files under a different heading.
		for (const shape of [S.textGen, S.imageGen, S.tts]) {
			const capability = capabilityForSamplingShape(shape)
			expect(capability).toBeDefined()
			expect(samplingShapeForCapability(capability!)).toBe(shape)
		}
	})

	test("capability → shape → capability is NOT the identity, and that is why one direction is hand-written", () => {
		// `S.imageGen` does not say which of the three image transforms was
		// meant, so the inverse can only name a representative. Deriving it —
		// the tempting symmetry — would have to pick one, and the pick would be
		// wrong for the other two.
		expect(capabilityForSamplingShape(S.imageGen)).toBe("text->image")
		expect(
			capabilityForSamplingShape(
				samplingShapeForCapability("image->image")
			)
		).toBe("text->image")
		expect(
			capabilityForSamplingShape(
				samplingShapeForCapability("text+image->image")
			)
		).toBe("text->image")
	})

	test("a shape that names no capability still names none", () => {
		// Connection slots ask this too, and their shape space is wider than
		// sampling's three: `core:shape/embeddings@1` and `core:shape/mcp@1` are
		// real. A `text->text` catch-all here layers the instance's TEXT default
		// onto an embeddings or MCP slot.
		expect(capabilityForSamplingShape(S.embeddings)).toBeUndefined()
		expect(capabilityForSamplingShape(S.mcp)).toBeUndefined()
		// An ABSENT shape is the one case that still means text: a row written
		// before the column existed should keep the answer it always got.
		expect(capabilityForSamplingShape(null)).toBe("text->text")
		expect(capabilityForSamplingShape(undefined)).toBe("text->text")
	})
})
