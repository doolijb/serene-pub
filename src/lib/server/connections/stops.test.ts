/**
 * The ONE composition point for stop sequences (ruling 2026-09-10).
 *
 * Four adapters used to carry the same twelve lines — `StopStrings.get` plus a
 * `Handlebars.compile` per string — and a fifth carried a ternary that sent none
 * at all on the chat wire. Five copies of one decision is five chances for the
 * wire rule to be applied differently, and it *was*: Ollama put the completion
 * template's role labels on its **chat** request (overriding the model's native
 * `<|im_end|>`), while OpenAI and llama.cpp deliberately did not, and KoboldCPP
 * sent nothing on chat at all — including the stop sequences the author had
 * typed into the step, which nothing read on any wire.
 *
 * This file pins the composition, not an adapter's payload: what goes out, what
 * is held back, and — the part no earlier arrangement could answer — *why* each
 * one, by `kind`.
 */
import { describe, expect, test } from "vitest"
import { composeStops, composeStopsFor, explicitStopsFrom } from "./stops"
import {
	BLOCK_ROLES,
	type CompletionTemplate,
	type RoleFraming
} from "$lib/shared/constants/completionTemplates"

const MARK = (role: string): RoleFraming => ({
	prefix: `@@${role}@@\n`,
	suffix: `@@stop@@\n`
})

/** Shares no bytes with any built-in, so a fallback resolution cannot pass. */
const CUSTOM: CompletionTemplate = {
	key: "acme-house-style",
	name: "Acme House Style",
	renderMode: "flat",
	roles: Object.fromEntries(
		BLOCK_ROLES.map((r) => [r, MARK(r)])
	) as CompletionTemplate["roles"],
	fallbackRole: MARK("user"),
	stopStrings: ["@@stop@@", "@@user@@"],
	isSelectable: true
}

const characters = [
	{ id: 1, name: "Ash", nickname: null },
	{ id: 2, name: "Vell", nickname: "V" }
] as any[]
const personas = [{ id: 7, name: "Rook" }] as any[]

const valuesOf = (list: { value: string }[]) => list.map((s) => s.value)
const kindOf = (list: { value: string; kind: string }[], value: string) =>
	list.find((s) => s.value === value)?.kind

describe("composeStops — the completion wire sends all three kinds", () => {
	test("format, speaker and explicit all go out, each tagged", () => {
		const { sent, dropped } = composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: ["<<END>>"],
			wire: "completion"
		})

		expect(dropped).toEqual([])
		expect(kindOf(sent, "@@stop@@")).toBe("format")
		expect(kindOf(sent, "Vell:")).toBe("speaker")
		expect(kindOf(sent, "V:")).toBe("speaker")
		expect(kindOf(sent, "Rook:")).toBe("speaker")
		expect(kindOf(sent, "<<END>>")).toBe("explicit")
	})

	test("the speaking character's own name is never a stop", () => {
		const { sent } = composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: [],
			wire: "completion"
		})
		// Ash is speaking: seeding `Ash: ` and also stopping on `Ash:` returns
		// an empty string from any model that opens by repeating the name.
		expect(valuesOf(sent)).not.toContain("Ash:")
		expect(valuesOf(sent)).toContain("Vell:")
	})

	test("{{char}} and {{user}} are rendered here, once", () => {
		const { sent } = composeStops({
			template: { ...CUSTOM, stopStrings: ["{{char}}:", "{{user}}:"] },
			characters,
			personas,
			currentCharacterId: null,
			explicit: ["stop, {{char}}"],
			wire: "completion"
		})
		// `resolveCharacterName` prefers the nickname; the persona is plain.
		expect(valuesOf(sent)).toContain("Ash:")
		expect(valuesOf(sent)).toContain("Rook:")
		expect(valuesOf(sent)).toContain("stop, Ash")
	})
})

describe("composeStops — the chat wire drops what has nothing to bite on", () => {
	test("only explicit survives; format and speaker are dropped by name", () => {
		const { sent, dropped } = composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: ["<<END>>"],
			wire: "chat"
		})

		expect(valuesOf(sent)).toEqual(["<<END>>"])
		expect(sent[0]!.kind).toBe("explicit")
		// Held back, not forgotten — the receipt shows what was withheld.
		expect(valuesOf(dropped)).toEqual(
			expect.arrayContaining(["@@stop@@", "@@user@@", "Vell:", "Rook:"])
		)
		expect(dropped.every((s) => s.kind !== "explicit")).toBe(true)
	})
})

describe("composeStops — the housekeeping", () => {
	test("a repeated value keeps its FIRST kind and appears once", () => {
		const { sent } = composeStops({
			// The template names the same string the author typed.
			template: { ...CUSTOM, stopStrings: ["<<END>>"] },
			characters: [],
			personas: [],
			currentCharacterId: null,
			explicit: ["<<END>>"],
			wire: "completion"
		})
		expect(valuesOf(sent)).toEqual(["<<END>>"])
		expect(sent[0]!.kind).toBe("format")
	})

	test("an empty template with no cast and no author composes nothing", () => {
		const { sent, dropped } = composeStops({
			template: { ...CUSTOM, stopStrings: [] },
			characters: [],
			personas: [],
			currentCharacterId: null,
			explicit: [],
			wire: "completion"
		})
		expect(sent).toEqual([])
		expect(dropped).toEqual([])
	})

	test("blank and whitespace-only entries never reach the wire", () => {
		const { sent } = composeStops({
			template: { ...CUSTOM, stopStrings: ["", "   "] },
			characters: [],
			personas: [],
			currentCharacterId: null,
			explicit: ["  ", ""],
			wire: "completion"
		})
		expect(sent).toEqual([])
	})

	test("an unclosed handlebars expression is sent verbatim, not thrown", () => {
		// The author types this into a textarea. A template error must cost a
		// stop sequence, never the turn.
		const { sent } = composeStops({
			template: { ...CUSTOM, stopStrings: [] },
			characters: [],
			personas: [],
			currentCharacterId: null,
			explicit: ["{{oops"],
			wire: "completion"
		})
		expect(valuesOf(sent)).toEqual(["{{oops"])
	})

	test("an absent template resolves to the default, not to nothing", () => {
		// The same fallback `BaseConnectionAdapter.completionTemplate` makes, so
		// the markers a prompt is wrapped in and the strings it stops on cannot
		// disagree for a connection that never went through a resolver.
		const { sent } = composeStops({
			template: null,
			characters: [],
			personas: [],
			currentCharacterId: null,
			explicit: [],
			wire: "completion"
		})
		expect(sent.length).toBeGreaterThan(0)
		expect(sent.every((s) => s.kind === "format")).toBe(true)
	})
})

/**
 * The one-line form every adapter-construction site uses.
 *
 * ⚠ **Five sites, and a site that forgets is silent.** An adapter composes
 * nothing of its own since the ruling of 2026-09-10, so a construction site that
 * skips `withStops` sends no stop sequences at all — and on a completion wire
 * that means the model runs on past its answer, reading as a bad model. The
 * derivation lives here so a site is one line rather than ten, and these cases
 * pin the two facts it reads off the row: they are the SAME two
 * `BaseConnectionAdapter` reads for the render, and a render/stop disagreement
 * has no error attached to it.
 */
describe("composeStopsFor — the derivation each construction site shares", () => {
	const CONNECTION = {
		type: "koboldcpp",
		promptFormat: CUSTOM.key,
		completionTemplate: CUSTOM,
		wireMode: "completion"
	}
	const SESSION = {
		sessionCharacters: [{ character: characters[1] }],
		sessionPersonas: [{ persona: personas[0] }]
	}

	test("reads the template row, the cast and the wire off what it is given", () => {
		const { sent } = composeStopsFor(CONNECTION, SESSION, {
			explicit: ["<<END>>"]
		})
		expect(valuesOf(sent)).toEqual(
			expect.arrayContaining(["@@stop@@", "Vell:", "V:", "Rook:", "<<END>>"])
		)
	})

	test("the row's own wire mode decides, so chat holds the rest back", () => {
		const { sent, dropped } = composeStopsFor(
			{ ...CONNECTION, wireMode: "chat" },
			SESSION,
			{ explicit: ["<<END>>"] }
		)
		expect(valuesOf(sent)).toEqual(["<<END>>"])
		expect(valuesOf(dropped)).toEqual(
			expect.arrayContaining(["@@stop@@", "Vell:"])
		)
	})

	test("a minimal session composes no speaker labels and still stops", () => {
		// The summarizer, the graph builder and `dispatchStep` all build a
		// session with no cast at all. Their template's stops must still reach
		// the wire: losing them is a summary that runs on past its answer.
		const { sent } = composeStopsFor(CONNECTION, {
			sessionCharacters: [],
			sessionPersonas: []
		})
		expect(valuesOf(sent)).toEqual(CUSTOM.stopStrings)
	})

	test("an absent session is an absent cast, not a crash", () => {
		expect(valuesOf(composeStopsFor(CONNECTION, undefined).sent)).toEqual(
			CUSTOM.stopStrings
		)
	})

	test("a row with a null character or persona is skipped, not named", () => {
		// The FKs are nullable with `onDelete: "set null"`, so a deleted
		// character leaves a join row with nothing to stop on.
		const { sent } = composeStopsFor(CONNECTION, {
			sessionCharacters: [{ character: null }, { character: characters[1] }],
			sessionPersonas: [{ persona: null }]
		})
		expect(valuesOf(sent)).toEqual([...CUSTOM.stopStrings, "Vell:", "V:"])
	})
})

describe("explicitStopsFrom — what an author typed", () => {
	test("takes the params control's array, trimmed, blanks dropped", () => {
		expect(explicitStopsFrom(["  <<END>>  ", "", "  ", "STOP"])).toEqual([
			"<<END>>",
			"STOP"
		])
	})

	test("takes a hand-authored newline string too", () => {
		expect(explicitStopsFrom("<<END>>\n\n  STOP  ")).toEqual([
			"<<END>>",
			"STOP"
		])
	})

	test("answers with nothing for a shape that is not text", () => {
		// Stopping on "[object Object]" is not a recovery from a mis-authored
		// spec; it is a second bug wearing the first one's clothes.
		expect(explicitStopsFrom({ nope: 1 })).toEqual([])
		expect(explicitStopsFrom(7)).toEqual([])
		expect(explicitStopsFrom(undefined)).toEqual([])
		expect(explicitStopsFrom([1, { a: 2 }])).toEqual([])
	})
})
