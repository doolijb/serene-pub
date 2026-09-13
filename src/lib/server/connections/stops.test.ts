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
import {
	composeStops,
	composeStopsFor,
	explicitStopsFrom,
	trimAtSpeakerBoundary
} from "./stops"
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

/**
 * A chat transcript whose message CONTENT carries `Name:` labels.
 *
 * The default context template renders `{{{name}}}: {{{message}}}` per line, so
 * a chat request's `assistant`/`user` turns read as a transcript and the trailing
 * seed turn is a bare `Ash:`. A model handed that continues it — writing the
 * player's next line, and the next character's — unless the labels are on the
 * wire as stop sequences. The roles carry structure; they do not carry WHOSE
 * turn each line is once the label is inside the content.
 */
describe("composeStops — the chat wire, with inline speaker labels", () => {
	/** What `parseSplitChatPrompt` hands an adapter for this cast. */
	const TRANSCRIPT = [
		{ role: "system", content: "You are Ash in this roleplay with Rook." },
		{ role: "assistant", content: "Ash: The archive is closed." },
		{ role: "user", content: "Rook: Good evening." },
		{ role: "assistant", content: "Ash:" }
	]

	const chat = (messages?: any[]) =>
		composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: ["<<END>>"],
			wire: "chat",
			messages
		})

	test("the other participants' labels ride the wire, newline-prefixed", () => {
		const { sent } = chat(TRANSCRIPT)
		expect(valuesOf(sent)).toEqual(
			expect.arrayContaining(["\nVell:", "\nV:", "\nRook:", "<<END>>"])
		)
		// A bare `Rook:` matches at position zero on a reply that opens with a
		// name, which returns nothing at all. The newline makes it a LINE.
		expect(valuesOf(sent)).not.toContain("Rook:")
	})

	test("the speaking character's own label is still never a stop", () => {
		expect(valuesOf(chat(TRANSCRIPT).sent)).not.toContain("\nAsh:")
	})

	test("every entry says why it is where it is", () => {
		const { sent, dropped } = chat(TRANSCRIPT)
		expect(sent.find((s) => s.value === "\nRook:")?.why).toContain(
			"inline speaker labels"
		)
		expect(sent.find((s) => s.value === "<<END>>")?.why).toContain("author")
		// The template's delimiters have nothing to bite on here, and sending
		// them overrides the model's native stop tokens.
		expect(valuesOf(dropped)).toEqual(
			expect.arrayContaining(["@@stop@@", "@@user@@"])
		)
		expect(dropped.find((s) => s.value === "@@stop@@")?.kind).toBe("format")
		expect(dropped.find((s) => s.value === "@@stop@@")?.why).toBeTruthy()
	})

	test("a transcript with no inline labels holds the speaker stops back", () => {
		const { sent, dropped } = chat([
			{ role: "system", content: "You are Ash." },
			{ role: "user", content: "Good evening." },
			{ role: "assistant", content: "" }
		])
		expect(valuesOf(sent)).toEqual(["<<END>>"])
		const held = dropped.find((s) => s.value === "Rook:")
		expect(held?.kind).toBe("speaker")
		expect(held?.why).toContain("no inline speaker labels")
	})

	test("a caller that hands over no messages holds them back too", () => {
		// The honest answer for a caller with nothing to read: a stop that has
		// nothing to match is a stop that overrides the model's own.
		expect(valuesOf(chat(undefined).sent)).toEqual(["<<END>>"])
	})

	test("a name in the system card is not a transcript label", () => {
		// The system turn carries the character cards as JSON, and a card names
		// everyone in the scene. Only the turns the model reads as a transcript
		// decide this.
		const { sent } = chat([
			{
				role: "system",
				content:
					'Cast:\n```json\n[{"name": "Rook"}]\n```\nRook: a card, not a turn'
			},
			{ role: "user", content: "Good evening." }
		])
		expect(valuesOf(sent)).toEqual(["<<END>>"])
	})
})

/**
 * The completion wire, unchanged.
 *
 * Its prompt is one flat transcript, so the labels match as written and the
 * newline form would miss a label the template puts at the very start of a
 * block.
 */
describe("composeStops — the completion wire is untouched by the chat rule", () => {
	test("the same session sends bare speaker labels and the format stops", () => {
		const { sent, dropped } = composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: ["<<END>>"],
			wire: "completion",
			messages: [
				{ role: "assistant", content: "Ash: The archive is closed." },
				{ role: "user", content: "Rook: Good evening." }
			]
		})
		expect(dropped).toEqual([])
		expect(valuesOf(sent)).toEqual(
			expect.arrayContaining([
				"@@stop@@",
				"@@user@@",
				"Vell:",
				"V:",
				"Rook:",
				"<<END>>"
			])
		)
		expect(valuesOf(sent).some((v) => v.startsWith("\n"))).toBe(false)
		expect(sent.every((s) => Boolean(s.why))).toBe(true)
	})
})

/**
 * The cut at the reply boundary — the belt to the stop sequence's braces.
 *
 * A backend may ignore a stop list entirely (several do on their chat leg), and
 * a reply that ran on into the next speaker's turn is the failure a reader sees
 * as the model writing both sides of the conversation. The labels come off the
 * composed list rather than from a second derivation, so the string the model
 * was told to stop on and the string that ends its reply are one fact.
 */
describe("trimAtSpeakerBoundary — where a reply ends", () => {
	const TRANSCRIPT = [
		{ role: "assistant", content: "Ash: The archive is closed." },
		{ role: "user", content: "Rook: Good evening." },
		{ role: "assistant", content: "Ash:" }
	]
	const stops = () =>
		composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: [],
			wire: "chat",
			messages: TRANSCRIPT
		})

	test("cuts at the first line opening with another participant's label", () => {
		const cut = trimAtSpeakerBoundary("*nods*\nRook: hi\nAsh: no", stops())
		expect(cut.text).toBe("*nods*")
		expect(cut.trimmedAt).toEqual({ label: "Rook:", offset: 6 })
	})

	test("a name mid-sentence is prose, and prose is kept", () => {
		const line = "She said Rook: was late, and meant every word."
		const cut = trimAtSpeakerBoundary(line, stops())
		expect(cut.text).toBe(line)
		expect(cut.trimmedAt).toBeUndefined()
	})

	test("a reply that never changes speaker is returned untouched", () => {
		const reply = "*nods*\nAsh keeps reading.\n\nThe lamp gutters."
		expect(trimAtSpeakerBoundary(reply, stops()).text).toBe(reply)
	})

	test("the speaker's own opening label is stripped once, and only there", () => {
		expect(trimAtSpeakerBoundary("Ash: *nods*", stops(), "Ash").text).toBe(
			"*nods*"
		)
		expect(
			trimAtSpeakerBoundary("*nods* Ash: no", stops(), "Ash").text
		).toBe("*nods* Ash: no")
	})

	test("a list carrying no speaker stops cuts nothing", () => {
		// A chat transcript with no inline labels composes no speaker stops, so
		// there is no label to end a reply on and nothing to cut.
		const plain = composeStops({
			template: CUSTOM,
			characters,
			personas,
			currentCharacterId: 1,
			explicit: [],
			wire: "chat",
			messages: [{ role: "user", content: "Good evening." }]
		})
		const reply = "*nods*\nRook: hi"
		expect(trimAtSpeakerBoundary(reply, plain).text).toBe(reply)
	})

	test("the completion wire's bare labels cut the same boundary", () => {
		const flat = composeStops({
			template: { ...CUSTOM, stopStrings: [] },
			characters,
			personas,
			currentCharacterId: 1,
			explicit: [],
			wire: "completion"
		})
		const cut = trimAtSpeakerBoundary("*nods*\n  Rook: hi", flat)
		expect(cut.text).toBe("*nods*")
		expect(cut.trimmedAt?.label).toBe("Rook:")
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
			expect.arrayContaining([
				"@@stop@@",
				"Vell:",
				"V:",
				"Rook:",
				"<<END>>"
			])
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
			sessionCharacters: [
				{ character: null },
				{ character: characters[1] }
			],
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
