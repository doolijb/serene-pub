/**
 * The section table is the sidebar's whole model of "a modality is a section".
 *
 * These are the properties the sidebar assumes and no longer checks, because it
 * reads the table instead of branching: a section per modality, one star
 * capability each, no two sections competing for one star, and a `modality`
 * vocabulary that is genuinely OPEN — the hard-coded `"text-gen" | "image-gen"`
 * union it replaced is what made embeddings a bespoke panel rather than a third
 * entry here.
 */

import { describe, expect, it } from "vitest"
import {
	CONNECTION_SECTIONS,
	MODALITY_FOR_STAR_CAPABILITY,
	modalityOfTransform,
	SECTION_STAR_CAPABILITIES,
	sectionForCapability,
	sectionForModality
} from "./connectionSections"
import { CONNECTION_TYPE } from "./ConnectionTypes"
import { withConnectionDefaults } from "../utils/connectionDefaults"
import { TRANSFORMS, isTransformId } from "@serene-pub/sdk"

describe("the section table", () => {
	it("names each modality exactly once", () => {
		const modalities = CONNECTION_SECTIONS.map((s) => s.modality)
		expect(new Set(modalities).size).toBe(modalities.length)
	})

	it("gives each section a star capability no other section claims", () => {
		// Two sections writing one `connection_defaults` row would move the star
		// from a list the person was not looking at.
		const stars = CONNECTION_SECTIONS.map((s) => s.starCapability)
		expect(new Set(stars).size).toBe(stars.length)
		expect(SECTION_STAR_CAPABILITIES.size).toBe(stars.length)
	})

	it("stars a TRANSFORM, which is the only thing connection_defaults keys", () => {
		// `connection_defaults`' primary key is the transform's two sides, so a
		// star naming a feature keys nothing and can never be satisfied.
		for (const s of CONNECTION_SECTIONS) {
			expect(
				isTransformId(s.starCapability),
				`${s.modality} stars "${s.starCapability}", which is not a transform id.`
			).toBe(true)
			expect(
				Object.keys(TRANSFORMS),
				`${s.modality} stars "${s.starCapability}", which this build does not name.`
			).toContain(s.starCapability)
		}
	})

	it("has at least one connection type declaring each section's modality", () => {
		// A section with no types is a card that opens an empty list with an
		// empty New Connection picker behind it.
		for (const s of CONNECTION_SECTIONS) {
			const types = CONNECTION_TYPE.options.filter(
				(o) => CONNECTION_TYPE.modalityOf(o.value) === s.modality
			)
			expect(
				types.length,
				`no connection type declares modality "${s.modality}".`
			).toBeGreaterThan(0)
		}
	})

	it("writes its modality onto a new connection of every one of its types", () => {
		// ⚠ The load-bearing field. The sidebar filters on the ROW's `modality`
		// column, so a type whose `CONNECTION_DEFAULTS` entry omits it produces a
		// connection filed under Large Language Models whatever the type says —
		// visible in the wrong list, offered for the wrong star.
		for (const s of CONNECTION_SECTIONS)
			for (const o of CONNECTION_TYPE.options.filter(
				(t) => CONNECTION_TYPE.modalityOf(t.value) === s.modality
			)) {
				const row = withConnectionDefaults({ type: o.value }) as {
					modality?: string
				}
				expect(
					row.modality ?? "text-gen",
					`a new ${o.value} connection is filed under "${row.modality ?? "text-gen"}", not "${s.modality}".`
				).toBe(s.modality)
			}
	})

	it("fills in every display field a card renders", () => {
		for (const s of CONNECTION_SECTIONS)
			for (const key of [
				"label",
				"description",
				"icon",
				"starVerb",
				"emptyMessage"
			] as const)
				expect(s[key], `${s.modality}.${key} is blank`).toBeTruthy()
	})

	it("writes no em-dash into UI copy", () => {
		// House rule. The strings here are rendered verbatim on the index cards.
		for (const s of CONNECTION_SECTIONS)
			for (const v of [
				s.label,
				s.description,
				s.starVerb,
				s.emptyMessage
			])
				expect(v).not.toContain("—")
	})
})

describe("the named-entities section", () => {
	// Spelled out rather than left to the table-wide properties above: this
	// section's star is what the annotation lane's broker reads, so a typo in it
	// is a lane that silently never loads a model.
	const ner = CONNECTION_SECTIONS.find((s) => s.modality === "ner")

	it("exists, and stars text->entities", () => {
		expect(ner, "no section declares the ner modality").toBeTruthy()
		expect(ner!.starCapability).toBe("text->entities")
	})

	it("says what entity extraction is for in its empty state", () => {
		// The empty message is the only place a person is told what starring a
		// NER connection buys them, so it names the mechanism rather than
		// repeating the heading.
		expect(ner!.emptyMessage.toLowerCase()).toContain("lore")
		expect(ner!.emptyMessage.toLowerCase()).toContain("name")
	})
})

describe("lookups", () => {
	it("finds a section by modality and by star", () => {
		for (const s of CONNECTION_SECTIONS) {
			expect(sectionForModality(s.modality)).toBe(s)
			expect(sectionForCapability(s.starCapability)).toBe(s)
			expect(MODALITY_FOR_STAR_CAPABILITY[s.starCapability]).toBe(
				s.modality
			)
		}
	})

	it("answers undefined for a modality nothing declares, never a default", () => {
		// A plugin's modality is not text generation. Answering with the text
		// section would file its connections in the LLM list and offer to star
		// one as the chat default.
		expect(sectionForModality("acme:weather")).toBeUndefined()
		expect(sectionForModality(null)).toBeUndefined()
		expect(sectionForModality(undefined)).toBeUndefined()
		expect(sectionForCapability("text->weather")).toBeUndefined()
	})
})

describe("modalityOf is an open vocabulary", () => {
	it("answers what the type declared, including a modality that is neither text nor image", () => {
		expect(CONNECTION_TYPE.modalityOf(CONNECTION_TYPE.OPENAI)).toBe(
			"text-gen"
		)
		expect(CONNECTION_TYPE.modalityOf(CONNECTION_TYPE.A1111)).toBe(
			"image-gen"
		)
		for (const type of [
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		])
			expect(
				CONNECTION_TYPE.modalityOf(type),
				`${type} must declare the embeddings modality, or the sidebar files it under LLMs.`
			).toBe("embeddings")
	})

	it("declares the ner modality for the local NER type", () => {
		// The fourth section's own half of the same contract the embedding types
		// have: a type filed under text-gen shows up in the LLM list and is
		// offered for the chat star.
		expect(CONNECTION_TYPE.modalityOf(CONNECTION_TYPE.LOCAL_ONNX_NER)).toBe(
			"ner"
		)
	})

	it("answers text-gen for a type nobody declared", () => {
		// What every type that predates the field is, and the likeliest answer
		// for an out-of-tree one.
		expect(CONNECTION_TYPE.modalityOf("acme:something")).toBe("text-gen")
	})

	it("keeps isImage a question about image generation only", () => {
		expect(CONNECTION_TYPE.isImage(CONNECTION_TYPE.A1111)).toBe(true)
		expect(
			CONNECTION_TYPE.isImage(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
		).toBe(false)
		expect(CONNECTION_TYPE.isImage(CONNECTION_TYPE.OPENAI)).toBe(false)
	})
})

describe("which modality a transform belongs to", () => {
	it("is read off what it produces, inputs included or not", () => {
		expect(modalityOfTransform("text->text")).toBe("text-gen")
		expect(modalityOfTransform("text+image->text")).toBe("text-gen")
		expect(modalityOfTransform("text->image")).toBe("image-gen")
		expect(modalityOfTransform("text+image->image")).toBe("image-gen")
		expect(modalityOfTransform("text->embedding")).toBe("embeddings")
		expect(modalityOfTransform("text->entities")).toBe("ner")
	})

	it("is null for a feature, and for an output no section owns", () => {
		expect(modalityOfTransform("tools")).toBeNull()
		expect(modalityOfTransform("text->audio")).toBeNull()
	})
})
