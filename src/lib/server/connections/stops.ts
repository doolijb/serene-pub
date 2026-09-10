/**
 * Stop sequences — composed ONCE, for every adapter (ruling 2026-09-10).
 *
 * ## What this replaced
 *
 * Four adapters (`OllamaAdapter`, `KoboldCppAdapter`, `LMStudioAdapter`,
 * `LlamaCppAdapter`) each carried the same twelve lines: `StopStrings.get` for
 * the template's own list plus the scene's `Name:` labels, then a
 * `Handlebars.compile` per string against a `{char, user}` context built from
 * the first character and the first persona. `OpenAIChatAdapter` carried a
 * fifth copy with no Handlebars pass at all, behind a ternary that sent an
 * empty list on the chat wire; `AnthropicAdapter` sent none, ever.
 *
 * Five copies of one decision are five chances to apply the wire rule
 * differently, and they did. Ollama put the completion template's role labels on
 * its **chat** request, where they override the model's native `<|im_end|>` and
 * truncate replies for no gain — the exact hazard OpenAI's and llama.cpp's chat
 * legs document at length in their own comments. And the one list that belongs
 * on every wire — the author's own `generate-text.params.stopSequences` — was
 * read by nobody at all.
 *
 * ## A stop has a KIND, and the kind is what decides
 *
 * A flat `string[]` cannot answer "why is this on the wire", so a wire rule
 * written over one can only ever be all-or-nothing. Each entry now says where it
 * came from:
 *
 *   · **`format`** — the completion template's `stopStrings` row. It names
 *     delimiters that only exist in a flat prompt string, so it is meaningless
 *     on a chat wire and actively harmful there.
 *   · **`speaker`** — `Name:` for everyone in the scene except whoever is
 *     speaking. Meaningful only where the prompt is a plain transcript, i.e.
 *     the completion wire.
 *   · **`explicit`** — what the author typed into the step's params. Their
 *     choice, not the template's, so it goes out on **any** wire.
 *
 * ## The wire rule, and it lives here
 *
 * `chat` sends `explicit` and holds the other two back; `completion` sends all
 * three. An adapter receives the finished list and maps it to its own field
 * name — nothing else. Held-back entries are RETURNED rather than discarded, so
 * the receipt can show a reader what was withheld and why, which is the half
 * that made the old behaviour undebuggable.
 */

import Handlebars from "handlebars"
import {
	completionTemplateOf,
	type CompletionTemplate
} from "$lib/shared/constants/completionTemplates"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import type { WireMode } from "$lib/shared/connectionAdapters/wireMode"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { resolveWireMode } from "./resolve"

/** Where a stop sequence came from — see the header. */
export type StopKind = "format" | "speaker" | "explicit"

export interface StopSequence {
	value: string
	kind: StopKind
}

export interface ComposedStops {
	/** What goes on the wire, in order, deduped. */
	sent: StopSequence[]
	/** What the wire rule held back. Never silently dropped. */
	dropped: StopSequence[]
	/** Which rule was applied, so a receipt reader need not infer it. */
	wire: WireMode
}

export interface ComposeStopsInput {
	/**
	 * The connection's completion template — the resolved ROW where a resolver
	 * loaded one, else the key.
	 *
	 * ⚠ A bare key resolves against the BUILT-INS, so an admin-authored template
	 * that names no built-in resolves to the default and the model is told to
	 * stop on markers its prompt does not contain. Nothing errors: the model
	 * simply never stops, and it reads as a bad model rather than a bad request.
	 * Pass the row wherever one exists — `BaseConnectionAdapter.completionTemplate`
	 * is the accessor that has it.
	 *
	 * Absent resolves to the DEFAULT template rather than to an empty list, which
	 * is the same answer `completionTemplateOf` gives the renderer for the same
	 * input — that agreement is what makes a render/stop disagreement unreachable
	 * rather than merely unlikely.
	 */
	template?: string | CompletionTemplate | null
	characters: {
		id?: number
		name?: string | null
		nickname?: string | null
	}[]
	personas: { name?: string | null }[]
	/** Whoever is speaking. Their own name must never end their own reply. */
	currentCharacterId?: number | null
	/** The author's own list, from `generate-text.params.stopSequences`. */
	explicit?: readonly string[] | null
	wire: WireMode
}

/**
 * Render `{{char}}` / `{{user}}` in a stop sequence.
 *
 * ⚠ Never throws. A stop sequence is free text an author types into a textarea,
 * and an unclosed `{{` is a typo that must cost that one entry rather than the
 * whole turn. The four adapters this replaced compiled unguarded.
 */
function render(value: string, context: Record<string, string>): string {
	try {
		return Handlebars.compile(value)(context)
	} catch {
		return value
	}
}

/**
 * The `Name:` labels for everyone in the scene except the speaker.
 *
 * This is what `server/utils/StopStrings.ts` held, minus the template half —
 * that half is a property of the FORMAT and belongs on the template row, which
 * is where `composeStops` reads it from. Nicknames are included alongside names
 * because either can open a line in a transcript.
 */
function speakerStops(input: ComposeStopsInput): string[] {
	const out: string[] = []
	for (const character of input.characters) {
		// Skip the current character: the prompt seeds `Ash: ` and stopping on
		// `Ash:` returns an empty string from any model that opens by repeating
		// the name.
		if (
			character.id !== undefined &&
			character.id === input.currentCharacterId
		)
			continue
		if (character.name) out.push(`${character.name}:`)
		if (character.nickname) out.push(`${character.nickname}:`)
	}
	for (const persona of input.personas) {
		if (persona.name) out.push(`${persona.name}:`)
	}
	return out
}

/**
 * What a connection stops on, and what it does not.
 *
 * Pure: everything it needs arrives as an argument, so the wire rule can be
 * asserted without a database, a connection or an adapter.
 */
export function composeStops(input: ComposeStopsInput): ComposedStops {
	// The SAME context the four adapters built, carried verbatim: the FIRST
	// character and the FIRST persona in the scene, not the speaker. They
	// agreed on it; `OpenAIChatAdapter` built none at all and so never rendered
	// a `{{char}}` its template declared — which is the sixth copy's own bug,
	// fixed by there no longer being a sixth copy.
	const context: Record<string, string> = {
		char: resolveCharacterName(input.characters[0]),
		user: input.personas[0]?.name || "user"
	}

	const candidates: StopSequence[] = [
		...completionTemplateOf(input.template).stopStrings.map((value) => ({
			value,
			kind: "format" as const
		})),
		...speakerStops(input).map((value) => ({
			value,
			kind: "speaker" as const
		})),
		...(input.explicit ?? []).map((value) => ({
			value,
			kind: "explicit" as const
		}))
	]

	const sent: StopSequence[] = []
	const dropped: StopSequence[] = []
	// Deduped by VALUE, first kind wins: one string can only stop generation
	// once, and the first source to name it is the one that explains it.
	const seen = new Set<string>()

	for (const candidate of candidates) {
		const value = render(candidate.value, context)
		// A blank stop sequence matches at position zero on every request — an
		// empty reply, every time, from an author's stray newline.
		if (!value.trim()) continue
		if (seen.has(value)) continue
		seen.add(value)
		const stop: StopSequence = { value, kind: candidate.kind }
		// The wire rule, in one line and one place. On a chat wire the roles
		// carry the structure, so the template's delimiters and the transcript's
		// speaker labels have nothing to bite on — and sending them OVERRIDES
		// the model's native stop tokens (`<|im_end|>` on a ChatML model),
		// truncating replies for no gain. The author's own list is their choice
		// rather than the template's, so it rides either wire.
		if (input.wire === "chat" && candidate.kind !== "explicit")
			dropped.push(stop)
		else sent.push(stop)
	}

	return { sent, dropped, wire: input.wire }
}

/**
 * The author's list, as typed.
 *
 * The params control stores `string[]` (one per line, trimmed by the textarea)
 * but a spec authored by hand — or a plugin — can put a single newline-joined
 * string there, and neither shape should reach the wire with a stray blank in
 * it. Anything else answers with nothing rather than with `[String(x)]`: a
 * number or an object in this slot is a mistake, and stopping on `"[object
 * Object]"` is not a recovery.
 */
export function explicitStopsFrom(value: unknown): string[] {
	const lines = Array.isArray(value)
		? value.map((v) => (typeof v === "string" ? v : ""))
		: typeof value === "string"
			? value.split("\n")
			: []
	return lines.map((line) => line.trim()).filter(Boolean)
}

/**
 * The stop list for a connection that is about to be handed a prompt.
 *
 * ## Why this exists, and why it must be the only way in
 *
 * There are FIVE places in this app that construct a text adapter and call
 * `generateText()` — `pipelines/runtime/dispatch.ts` (every Provider node),
 * `utils/generateResponse.ts` (every reply), `utils/summarizer/index.ts`,
 * `utils/graphBuilder.ts` and `pipelines/runtime/dispatchStep.ts`. An adapter no
 * longer composes for itself, so a construction site that forgets `withStops`
 * sends NO stop sequences at all — and on a completion wire that means the model
 * runs on past its answer, which is the silent failure this whole area exists to
 * remove. Five copies of the ten-line derivation would be five chances to get it
 * subtly wrong, which is the shape the ruling replaced.
 *
 * So the derivation is here, once, and each site is one line. The two facts it
 * reads off the row are exactly the two `BaseConnectionAdapter` reads for the
 * RENDER — `completionTemplate ?? promptFormatOf(promptFormat)` and
 * `wireMode ?? resolveWireMode(row)` — because the markers a prompt is wrapped in
 * and the strings it stops on disagreeing is a failure with no error attached to
 * it.
 *
 * A minimal or absent session (the summarizer's, the graph builder's) simply has
 * no cast, so it composes no `speaker` entries — the honest answer rather than a
 * special case.
 */
export function composeStopsFor(
	connection: unknown,
	session:
		| {
				sessionCharacters?: { character?: unknown }[] | null
				sessionPersonas?: { persona?: unknown }[] | null
		  }
		| null
		| undefined,
	opts: { currentCharacterId?: number | null; explicit?: unknown } = {}
): ComposedStops {
	const row = (connection ?? {}) as {
		completionTemplate?: CompletionTemplate | null
		promptFormat?: string | null
		wireMode?: WireMode | null
	}
	return composeStops({
		template: row.completionTemplate ?? promptFormatOf(row.promptFormat),
		characters: (session?.sessionCharacters ?? [])
			.map((cc) => cc?.character)
			.filter(Boolean) as ComposeStopsInput["characters"],
		personas: (session?.sessionPersonas ?? [])
			.map((cp) => cp?.persona)
			.filter(Boolean) as ComposeStopsInput["personas"],
		currentCharacterId: opts.currentCharacterId ?? null,
		explicit: explicitStopsFrom(opts.explicit),
		wire: row.wireMode ?? resolveWireMode(row as any)
	})
}
