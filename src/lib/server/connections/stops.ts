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
 *     speaking. Meaningful wherever the prompt carries those labels INSIDE the
 *     text the model reads, which is every completion prompt and every chat
 *     transcript the default context template renders.
 *   · **`explicit`** — what the author typed into the step's params. Their
 *     choice, not the template's, so it goes out on **any** wire.
 *
 * ## The wire rule, and it lives here
 *
 * `completion` sends all three: the prompt is one flat string, so every kind has
 * something in it to match.
 *
 * `chat` always sends `explicit`, always holds `format` back, and sends
 * `speaker` exactly when the compiled messages carry `Name:` labels inside their
 * content. The default context template renders `{{{name}}}: {{{message}}}` per
 * line and seeds a trailing `Verity:`, so the roles mark where a turn ends while
 * the label inside the content is what says whose turn the next line is — and a
 * model handed that transcript writes the next line too, for both sides. A
 * template delimiter has nothing to bite on between role boundaries and
 * overrides the model's native EOS, so `format` stays held back either way.
 *
 * A `speaker` stop rides the chat wire newline-prefixed (`"\nRook:"`): a bare
 * label matches at position zero on a reply that opens with a name, which ends
 * the reply before it has said anything.
 *
 * Every entry carries the sentence that decided it (`why`), sent or held back.
 * An adapter receives the finished list and maps it to its own field name —
 * nothing else. Held-back entries are RETURNED rather than discarded, so the
 * receipt can show a reader what was withheld and why, which is the half that
 * made the old behaviour undebuggable.
 *
 * ## The cut at the reply boundary
 *
 * `trimAtSpeakerBoundary` is the same rule applied to what came back, because a
 * backend may honour no stop list at all. It reads the labels off the composed
 * list rather than deriving them again, so the string the model was told to stop
 * on and the string that ends its reply are one fact.
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
	/**
	 * The sentence that put this entry where it is, sent or held back.
	 *
	 * The kind says where a stop came FROM; a reader looking at a reply that ran
	 * on needs to know what the wire rule then did with it. Optional so a
	 * hand-built list (a test's literal, a stored receipt) still satisfies the
	 * type; `composeStops` fills it on every entry it produces.
	 */
	why?: string
}

/** Where a reply was cut short of what the model actually wrote. */
export interface ReplyTrim {
	/** The label that ended it, as composed (`"Rook:"`). */
	label: string
	/** How many characters of the reply were kept. */
	offset: number
}

export interface TrimmedReply {
	text: string
	/** Absent when nothing was cut. Never a silent truncation. */
	trimmedAt?: ReplyTrim
}

/**
 * A compiled payload's messages, as narrow as the one question asked of them.
 *
 * Named so a caller holding an adapter payload can hand it over without a cast
 * to `any` and without this module learning the whole `CompiledPrompt` shape.
 */
export type CompiledMessagesProbe = readonly {
	role?: string | null
	content?: unknown
}[]

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
	/**
	 * The compiled turn's messages, for the one question the chat wire asks of
	 * them: does the CONTENT carry `Name:` labels?
	 *
	 * The payload itself is the honest signal — it is the bytes the model reads,
	 * and it already survived whatever the context template, the genre and any
	 * plugin assembler did to it. Reading the template instead would be a second
	 * derivation of a fact the caller is already holding.
	 *
	 * Absent means "the caller has none to show", which answers no, and that is
	 * the safe answer: a stop that matches nothing in the prompt is a stop that
	 * overrides the model's native EOS for no gain. The completion wire never
	 * consults this.
	 */
	messages?: CompiledMessagesProbe | null
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
function speakerStops(input: ComposeStopsInput, all = false): string[] {
	const out: string[] = []
	for (const character of input.characters) {
		// Skip the current character: the prompt seeds `Ash: ` and stopping on
		// `Ash:` returns an empty string from any model that opens by repeating
		// the name. `all` is the detection's question instead — the seed line
		// carries the speaker's own label and is often the only labelled line a
		// fresh session has.
		if (
			!all &&
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

/** A name is free text a user typed, so it reaches a pattern escaped. */
const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A label that OPENS a line, which is the only place one means a change of turn.
 *
 * Mid-sentence is prose: "She said Rook: was late" is one speaker's line, and a
 * rule that fired there would eat replies for naming somebody.
 *
 * `anchored` includes the very start of the text. That is what a message's own
 * first line is, so the DETECTION wants it; a cut does not, because the start of
 * a reply is the speaker's own turn rather than a change of one.
 */
const atLineStart = (labels: readonly string[], anchored: boolean) =>
	new RegExp(
		`${anchored ? "(?:^|\\n)" : "\\n"}[ \\t]*(${labels
			.map(escapeRegExp)
			.join("|")})`
	)

/**
 * The form a `speaker` stop takes on the chat wire.
 *
 * A bare `Rook:` matches at position zero on a reply that opens by naming
 * somebody, and a stop that matches at zero is an empty reply from every model.
 * The newline is what makes the match a LINE rather than a prefix.
 */
const CHAT_SPEAKER_PREFIX = "\n"

/**
 * Does the text the model reads carry `Name:` labels inside the message
 * content?
 *
 * `system` turns are skipped: they carry the character cards, and a card names
 * everyone in the scene without the transcript using labels at all.
 */
function inlinesSpeakerLabels(input: ComposeStopsInput): boolean {
	const messages = input.messages ?? []
	if (!messages.length) return false
	const labels = speakerStops(input, true)
	if (!labels.length) return false
	const probe = atLineStart(labels, true)
	for (const message of messages) {
		if (message?.role === "system") continue
		const content =
			typeof message?.content === "string" ? message.content : ""
		if (content && probe.test(content)) return true
	}
	return false
}

/** The sentences a receipt reader meets, one per decision this rule makes. */
const WHY = {
	explicit: "the author's own list rides every wire",
	formatFlat: "the flat prompt is wrapped in this template's delimiters",
	speakerFlat: "the flat prompt is a transcript with inline speaker labels",
	formatChat:
		"the roles carry the structure on a chat wire, so a template delimiter " +
		"matches nothing and overrides the model's native stop tokens",
	speakerChatInline: "inline speaker labels on the chat wire",
	speakerChatPlain:
		"the chat transcript carries no inline speaker labels, so this would " +
		"match nothing and override the model's native stop tokens"
} as const

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

	const chat = input.wire === "chat"
	// Asked ONCE per request rather than per candidate: the answer is a property
	// of the payload, not of any one stop sequence.
	const inline = chat && inlinesSpeakerLabels(input)

	for (const candidate of candidates) {
		const rendered = render(candidate.value, context)
		// A blank stop sequence matches at position zero on every request — an
		// empty reply, every time, from an author's stray newline.
		if (!rendered.trim()) continue
		// The wire rule, in one place. A `format` stop names a delimiter of a
		// flat prompt, so on a chat wire it matches nothing and OVERRIDES the
		// model's native stop tokens (`<|im_end|>` on a ChatML model). A
		// `speaker` stop matches wherever the label is inside the text, which is
		// every flat prompt and every chat transcript that renders one. The
		// author's own list is their choice rather than the template's, so it
		// rides either wire.
		const send =
			candidate.kind === "explicit" ||
			!chat ||
			(candidate.kind === "speaker" && inline)
		const value =
			chat && candidate.kind === "speaker" && inline
				? `${CHAT_SPEAKER_PREFIX}${rendered}`
				: rendered
		// Deduped on the value as it goes out, so a template whose own stop
		// strings name a participant cannot swallow that participant's speaker
		// stop on the one wire where the two take different forms.
		if (seen.has(value)) continue
		seen.add(value)
		const why =
			candidate.kind === "explicit"
				? WHY.explicit
				: !chat
					? candidate.kind === "format"
						? WHY.formatFlat
						: WHY.speakerFlat
					: candidate.kind === "format"
						? WHY.formatChat
						: inline
							? WHY.speakerChatInline
							: WHY.speakerChatPlain
		const stop: StopSequence = { value, kind: candidate.kind, why }
		if (send) sent.push(stop)
		else dropped.push(stop)
	}

	return { sent, dropped, wire: input.wire }
}

/**
 * Where a reply ends, when the backend did not end it there.
 *
 * ## Belt, and the stop list is the braces
 *
 * Several services ignore a stop list on their chat leg, and a model handed a
 * labelled transcript continues it: the reply carries the player's next line and
 * the next character's, which reads as the app writing both sides of the
 * conversation. This cuts at the first line that opens with another
 * participant's label, so the boundary holds whatever the backend honoured.
 *
 * ## The labels come off the composed list
 *
 * From `sent`, and only the `speaker` kind. A second derivation of "who else is
 * in this scene" is how the string a model is told to stop on and the string
 * that ends its reply come to disagree. It also means the cut is inert exactly
 * where no speaker stop was asked for — a chat transcript with no inline labels,
 * a summarizer's cast-less session — rather than needing a second rule to say
 * so.
 *
 * ⚠ Line starts only, and never the reply's own first line. Mid-sentence is
 * prose, and a rule that fired on "She said Rook: was late" would eat a reply
 * for naming somebody; a reply that opens as somebody else keeps its bytes,
 * because a blank row says less to a reader than the runaway does. This is the
 * same boundary the newline-prefixed stop draws on the wire.
 *
 * `own` is the speaker's own name, whose opening label is theirs to lose once:
 * the chat wire seeds a trailing `Verity:` and a model that repeats it would
 * otherwise show the label to the reader.
 */
export function trimAtSpeakerBoundary(
	text: string,
	stops: ComposedStops,
	own?: string | null
): TrimmedReply {
	let out = text
	const ownLabel = own?.trim() ? `${own.trim()}:` : ""
	if (ownLabel) {
		const opener = new RegExp(`^[ \\t]*${escapeRegExp(ownLabel)}`)
		if (opener.test(out)) out = out.replace(opener, "").trimStart()
	}

	const labels = stops.sent
		.filter((stop) => stop.kind === "speaker")
		// The chat wire's newline prefix is part of the WIRE form; the label is
		// what a line opens with.
		.map((stop) => stop.value.replace(/^\n/, ""))
	if (!labels.length) return { text: out }

	const match = atLineStart(labels, false).exec(out)
	if (!match) return { text: out }

	return {
		text: out.slice(0, match.index).trimEnd(),
		trimmedAt: { label: match[1]!, offset: match.index }
	}
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
 * There are FOUR places in this app that construct a text adapter and call
 * `generateText()` — `pipelines/runtime/dispatch.ts` (every Provider node,
 * which since the one road is every reply too), `utils/summarizer/index.ts`,
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
	opts: {
		currentCharacterId?: number | null
		explicit?: unknown
		/**
		 * The payload about to go out, for the chat wire's inline-label
		 * question. A site that cannot reach one hands over nothing, and its
		 * speaker stops stay held back with the reason on the receipt.
		 */
		messages?: CompiledMessagesProbe | null
	} = {}
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
		wire: row.wireMode ?? resolveWireMode(row as any),
		messages: opts.messages ?? null
	})
}
