/**
 * The template context, built from Query results instead of a hydrated session.
 *
 * This is the last coupling in the prompt path. `PromptBuilder.buildTemplateContext`
 * reads `this.assistantCharacters`, `this.userCharacters`, `this.session` and
 * `this.interpolationEngine`, so it can only run where all four already exist —
 * which is the reason the whole prompt path has to be constructed before any of
 * it can be used.
 *
 * Here the same object is produced from explicit arguments. The rule applied
 * throughout is: **this builder resolves nothing.** Which characters are
 * visible, which scenario wins between the session's and the character's, which
 * post-history text belongs to the speaker — every one of those is a decision
 * with its own rules, and every one of them is made upstream and handed in. The
 * builder interpolates, joins, stringifies and assembles a shape. That is what
 * makes it a Task (F11 — a Task is handed no services), and it is also what
 * makes a parity failure localisable: if the output differs, either an input
 * differed or the interpolation differed, and those are separable.
 *
 * **Interpolation is the legacy engine, deliberately.** `InterpolationEngine`
 * expands `{{char}}`, `{{user}}` and the card macros, and reimplementing that
 * would produce a context that differs from the legacy path in ways only a user
 * with an unusual character card would find. Same engine, same fields, same JSON
 * formatting — so a difference in output is a difference in *inputs*.
 */

import { InterpolationEngine } from "$lib/server/utils/interpolation/InterpolationEngine"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import type { TemplateContext } from "$lib/server/pipelines/prompt/promptTypes"
import type { VarValue } from "@serene-pub/sdk"
import type { TEMPLATE_CONTEXT_SCHEMA } from "@serene-pub/contracts"
import {
	renderVariable,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"
import type { RenderRun } from "$lib/server/pipelines/prompt/renderers"
import { relationshipSections } from "$lib/server/pipelines/prompt/rankedRelationships"
import { qualifiedSlotKey, slotKey } from "$lib/server/state/keys"
import { readAuthorsNoteValue } from "$lib/server/pipelines/prompt/authorsNote"

export interface CharacterRow {
	id?: number
	name: string
	nickname?: string | null
	description?: string | null
	personality?: string | null
	[key: string]: unknown
}

export interface PersonaRow {
	id?: number
	name: string
	description?: string | null
	[key: string]: unknown
}

/**
 * The six prompt texts, already resolved.
 *
 * They are six rather than three because the legacy path keeps three pairs
 * apart, and collapsing any pair changes the prompt:
 *
 * - `exampleDialogue` / `charExampleDialogue` — the top-level variable and the
 *   copy that travels inside `postHistory`. Today the builder assigns them the
 *   same value (index.ts:340), but they are read by different templates and a
 *   character-specific example set is the obvious next thing to diverge.
 * - `postHistoryInstructions` / `promptPostHistoryInstructions` — the prompt
 *   *config's* instructions and the ones the renderer places next to the seed.
 *   `postHistory.instructions` is the second one. Feeding it the first is the
 *   mistake this split exists to prevent.
 * - `charPostHistory` — the speaking character's own reinforcement text, which
 *   is resolved from the current character, not looked up by name from the cast.
 */
export interface PromptTexts {
	instructions?: string
	exampleDialogue?: string
	postHistoryInstructions?: string
	charExampleDialogue?: string
	promptPostHistoryInstructions?: string
	charPostHistory?: string
}

/**
 * `RenderRun` is on the input because every one of the layouts below can name a
 * plugin's engine — a dozen sandboxed hook calls, in a run that can be
 * cancelled while they are in flight. Absent for a caller with no run.
 */
export interface BuildContextInput extends RenderRun {
	/** Characters the assistant speaks as, compiled at the session's `characterDetail`. */
	characters: readonly CharacterRow[]
	personas: readonly PersonaRow[]
	/**
	 * Display names for `{{characterNames}}` — **the enabled subset**, resolved
	 * upstream (`promptFields.resolveContextInput`).
	 *
	 * Deliberately not derived from `characters`: the blob above includes
	 * switched-off characters, while the joined list must not name them.
	 * Deriving one from the other would silently put a switched-off
	 * character's name into every prompt.
	 */
	characterNames: readonly string[]
	/** Display names for `{{personaNames}}`, resolved upstream. */
	personaNames: readonly string[]
	/** Whose turn it is — `{{char}}` and `{{character}}`. */
	charName: string
	/** Who they are speaking to — `{{user}}` and `{{persona}}`. */
	personaName: string
	/** Narrator mode's configured display name, for `{{narratorName}}`. */
	narratorName?: string
	texts?: PromptTexts
	/** The winning scenario text, already chosen between session and character. */
	scenario?: string | null
	/**
	 * The narrative graph, as structure, in two halves.
	 *
	 * Was one `speakerRelationships` string, because `buildGraphContext`
	 * stringified before this saw it. The layouts do that now, so what arrives
	 * here is the shape — which is what makes a prose rendering of somebody's
	 * relationships possible at all — and it arrives as two values, because
	 * "how they see everyone" and "how everyone sees them" are opposite claims
	 * that shared one heading, one layout and one switch.
	 *
	 * Either the section itself, or a wired port carrying the allocated
	 * `relationships` band with that section behind it — `relationshipSections`
	 * decides, and hands back a section either way.
	 */
	relationshipsPerspectives?: unknown
	relationshipsKnown?: unknown
	/**
	 * The `variables` slot, resolved through the scope chain and dereferenced
	 * into template sources by `world.ts`.
	 *
	 * Absent, empty, or missing a key all mean the same thing — use the in-code
	 * expression — so this stays optional and every render site keeps its
	 * default. See `variableLayouts.ts`.
	 */
	variables?: ResolvedLayouts
	/**
	 * The session's resolved state, when a spec wired
	 * `core:query/session-state@1` into the builder's `state` port. Structure a
	 * template reads keys out of, not a value anything here renders — and
	 * projected to its TYPE (`templateState`, typed templates P6) rather than
	 * passed through: what `session-state` publishes also carries the id
	 * indexes, the vocabulary, the roles and the version, none of which the
	 * typed scope declares.
	 */
	state?: unknown
	/**
	 * The session's own genre fields, by key — `tone`, `difficulty`, and
	 * whatever else a genre declared.
	 *
	 * ⚠ **They have to arrive HERE, not be merged onto the answer.**
	 * `instructions` is interpolated inside this function, so a shipped prompt
	 * saying "Difficulty is {{difficulty}}" renders "Difficulty is " for any
	 * caller that adds the fields to the context this returns. A live receipt
	 * is where that reads as "Keep the tone ." The merge above the caller stays,
	 * for the templates reading the same keys; this is what makes a prompt row
	 * read them too.
	 *
	 * The four names an interpolation context owns — `char`, `character`,
	 * `user`, `persona` — are never taken from here: a genre field called
	 * `char` is a field, not a rename of the speaker.
	 */
	fields?: Record<string, unknown>
	/**
	 * 🚧 The session's AI replies before this one (AN1) — what the author's
	 * note's `interval` divides. Off the cast read, which carries it only for
	 * a session whose genre declares the note; absent otherwise.
	 */
	replyCount?: number
}

/** The names an interpolation context owns; a genre field may not take one. */
const RESERVED_FIELD_NAMES = new Set(["char", "character", "user", "persona"])

/**
 * A genre's fields as interpolation variables: a plain bag, reserved names
 * out — and the author's note out when it is the note (an object): it is
 * placed by Assemble as its own block, and `{{authorsNote}}` in a prompt row
 * would otherwise render `[object Object]`. A plugin's text field of the same
 * name stays a variable (see `readAuthorsNoteValue`).
 */
function genreFields(fields: unknown): Record<string, unknown> {
	if (!fields || typeof fields !== "object" || Array.isArray(fields))
		return {}
	return Object.fromEntries(
		Object.entries(fields as Record<string, unknown>).filter(
			([key, value]) =>
				!RESERVED_FIELD_NAMES.has(key) &&
				!(key === "authorsNote" && readAuthorsNoteValue(value))
		)
	)
}

/**
 * Build the context a context template renders against.
 *
 * Returns the legacy `TemplateContext` shape exactly, minus
 * `__promptBuilderInstance` — that field is a back-reference the 0.5 retrieval paths
 * used to reach back into the builder, and its absence here is the coupling
 * being removed rather than an omission. A pipeline node cannot reach back into
 * anything; everything it needs arrived on a port.
 */
export async function buildTemplateContext(
	input: BuildContextInput
): Promise<TemplateContext> {
	const interpolation = new InterpolationEngine()
	const texts = input.texts ?? {}

	// The legacy context, built by the legacy method rather than reproduced as
	// an object literal — so that a field added to it arrives here too instead
	// of quietly going missing.
	const interpolationContext = interpolation.createInterpolationContext({
		currentCharacterName: input.charName,
		currentPersonaName: input.personaName,
		additionalContext: {
			// First, so the four reserved names below and the speaker's own
			// cannot be taken by a genre field that happens to share one.
			...genreFields(input.fields),
			characterNames: joinWithAnd([...input.characterNames]),
			personaNames: joinWithAnd([...input.personaNames]),
			narratorName: input.narratorName
		}
	})

	// The cards are the characters as written. Lore bound to a cast member is
	// Assemble's `characterLore`, which the context template places itself.
	const characters = input.characters.map((c) =>
		interpolation.interpolateObject(c as any, interpolationContext, [
			"name",
			"nickname",
			"description",
			"personality"
		])
	)
	const personas = input.personas.map((p) =>
		interpolation.interpolateObject(p as any, interpolationContext, [
			"name",
			"description"
		])
	)

	const interpolate = (s: string | null | undefined): string =>
		interpolation.interpolateString(s ?? "", interpolationContext) ?? ""

	const postHistoryInstructions = interpolate(texts.postHistoryInstructions)
	const promptPostHistoryInstructions = interpolate(
		texts.promptPostHistoryInstructions
	)
	const charPostHistory = interpolate(texts.charPostHistory)
	const charExampleDialogue = interpolate(texts.charExampleDialogue)

	/**
	 * 🚧 The session's author's note (AN1), when its genre declares one: the
	 * stored value with its text interpolated (`{{char}}`, `{{user}}`, as
	 * SillyTavern's note is), carried to Assemble — which places it against
	 * the final messages and decides the interval, as it does `postHistory`.
	 * Absent for every genre that declares no note, so their context is the
	 * object it was.
	 */
	const note = readAuthorsNoteValue(
		input.fields && typeof input.fields === "object"
			? (input.fields as Record<string, unknown>).authorsNote
			: undefined
	)
	const authorsNoteText = note ? interpolate(note.text) : ""

	/**
	 * Each top-level variable now goes through its selected layout, and the
	 * expression that used to be here is that layout's floor.
	 *
	 * The shipped layouts reproduce the old code byte for byte — `characters`
	 * was `JSON.stringify(x, null, 2)` and its shipped source is
	 * `{{{json characters 2}}}`, which is the same bytes — so an install that
	 * has changed nothing gets exactly the prompt it got before. The
	 * indentation is not a formatting detail: the default context templates
	 * consume these as raw JSON and the whitespace goes to the model.
	 *
	 * These stay **strings**. Not for a test's sake: every existing install has
	 * `context_configs.template` rows containing `{{{characters}}}`, and handing
	 * that an array would render `[object Object],[object Object]` in every
	 * user's template. Presentation moves into the layout; the type on the way
	 * out does not move at all.
	 */
	const layout = (key: string, value: unknown) =>
		renderVariable(input.variables, key, value, input)

	// Held to the builder's declared out-port schema (typed templates P3):
	// `satisfies` refuses a key the declaration lacks and a declared key this
	// leaves out, so the template editor's scope and what renders cannot part.
	return {
		instructions: await layout(
			"instructions",
			interpolate(texts.instructions)
		),
		// Whatever the port carried — the allocated band when a spec wired the
		// mechanism, the traversal's own section when it did not. See
		// `rankedRelationships.ts`; a value that is not a wired port arrives
		// here unchanged.
		relationshipsPerspectives: await layout(
			"relationshipsPerspectives",
			relationshipSections(
				input.relationshipsPerspectives,
				"perspectives"
			)
		),
		relationshipsKnown: await layout(
			"relationshipsKnown",
			relationshipSections(input.relationshipsKnown, "known")
		),
		characters: await layout("characters", characters),
		personas: await layout("personas", personas),
		characterNames: await layout(
			"characterNames",
			interpolationContext.characterNames
		),
		personaNames: await layout(
			"personaNames",
			interpolationContext.personaNames
		),
		scenario: await layout("scenario", interpolate(input.scenario)),
		// Empty string rather than undefined. The legacy path leaves these
		// `undefined` when the config has no text; both render as nothing and
		// both are falsy under `{{#if}}`, so the prompt is unchanged — but a
		// context that is inspected before it renders should not show a hole
		// where "the config has no example dialogue" is the actual answer.
		exampleDialogue: await layout(
			"exampleDialogue",
			interpolate(texts.exampleDialogue)
		),
		postHistoryInstructions: await layout(
			"postHistoryInstructions",
			postHistoryInstructions
		),
		// `targetIndex` is a placeholder here exactly as it is in the legacy
		// builder: the final message array is not known until allocation has
		// run, so Assemble overwrites it. Left in rather than omitted so the
		// shape is stable for a template that reads it.
		//
		// `instructions` is ungated here for the same reason: the history it is
		// measured against is not assembled yet. `gatedBy` names the node that
		// decides, so a reader of this node's output knows which copy this is.
		postHistory: {
			gatedBy: "assemble" as const,
			targetIndex: 0,
			instructions: promptPostHistoryInstructions || undefined,
			charInstructions: charPostHistory || undefined,
			exampleDialogue: charExampleDialogue || undefined,
			hasContent: Boolean(
				promptPostHistoryInstructions ||
					charPostHistory ||
					charExampleDialogue
			)
		},
		...(note
			? {
					authorsNote: {
						gatedBy: "assemble" as const,
						targetIndex: 0,
						text: authorsNoteText || undefined,
						role: note.role,
						depth: note.depth,
						interval: note.interval,
						...(typeof input.replyCount === "number"
							? { replyCount: input.replyCount }
							: {}),
						hasContent: Boolean(authorsNoteText.trim())
					}
				}
			: {}),
		sessionMessages: [],
		// Structure, unrendered, and absent when nothing supplied it — so a
		// template that tests `{{#if state}}` gets the honest answer.
		...(input.state ? templateStateEntry(input.state) : {}),
		char: input.charName,
		character: input.charName,
		user: input.personaName,
		persona: input.personaName
	} satisfies VarValue<typeof TEMPLATE_CONTEXT_SCHEMA>
}

/** `{ state }` when the resolved state projects to one, else nothing. */
function templateStateEntry(
	state: unknown
): { state: TemplateContext["state"] } | Record<string, never> {
	const projected = templateState(state)
	return projected ? { state: projected } : {}
}

/**
 * The session's resolved state as a template's `state` is TYPED (typed
 * templates P6; SDK `templateScopeAt`'s `stateVarField`):
 *
 * - `world` — `<slot>` and `<owner_slot>` for every slot the session TRACKS
 *   on the world;
 * - `cast.<member>` — `id`, `key`, `name` and the tracked cast slots, by the
 *   member's slug;
 * - `locations.<place>` — the same for a place and its tracked location
 *   slots; absent when the session tracks none.
 *
 * "Tracked" is the vocabulary `session-state` resolved (`state.slots`): a
 * value under any other key — an untracked slot, a stray key — stays out, so
 * what renders is what the type says. The id indexes (`cast.byId`,
 * `locations.byId`), the vocabulary itself, `who` and `version` are the
 * session-state node's for pipelines and conditions, not a template's.
 * Undefined for anything that is not a resolved state.
 */
export function templateState(state: unknown): TemplateContext["state"] | undefined {
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined
	const s = state as {
		world?: unknown
		cast?: unknown
		locations?: unknown
		slots?: unknown
	}
	const tracked = Array.isArray(s.slots)
		? (s.slots as Array<{ id?: unknown; appliesTo?: unknown }>).filter(
				(t): t is { id: string; appliesTo: string[] } =>
					typeof t?.id === "string" && Array.isArray(t.appliesTo)
			)
		: []
	const keysFor = (applies: string): Set<string> =>
		new Set(
			tracked
				.filter((t) => t.appliesTo.includes(applies))
				.flatMap((t) => [slotKey(t.id), qualifiedSlotKey(t.id)])
		)
	const isBag = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === "object" && !Array.isArray(v)
	const pick = (bag: unknown, keys: Set<string>, identity: boolean) => {
		const out: Record<string, unknown> = {}
		if (!isBag(bag)) return out
		if (identity)
			for (const k of ["id", "key", "name"] as const)
				if (bag[k] !== undefined) out[k] = bag[k]
		for (const k of keys) if (bag[k] !== undefined) out[k] = bag[k]
		return out
	}
	// Slug-keyed holders only: `byId` is the index beside them.
	const holders = (index: unknown, applies: string) => {
		const keys = keysFor(applies)
		const out: Record<string, Record<string, unknown>> = {}
		if (!isBag(index)) return out
		for (const [slug, holder] of Object.entries(index))
			if (slug !== "byId" && isBag(holder)) out[slug] = pick(holder, keys, true)
		return out
	}
	const locations = holders(s.locations, "location")
	return {
		world: pick(s.world, keysFor("world"), false),
		cast: holders(s.cast, "cast"),
		...(Object.keys(locations).length ? { locations } : {})
	}
}
