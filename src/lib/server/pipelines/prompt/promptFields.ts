/**
 * From cast rows to the template context's inputs.
 *
 * `buildTemplateContext` deliberately resolves nothing (see its header). This
 * is where the resolving happens: which characters appear in the cards, which
 * of them get named in `{{characterNames}}`, which scenario wins, and which of
 * the six prompt texts each field draws from.
 *
 * Every rule below is the legacy rule, and the ones that are *only* expressible
 * as a rule — the detail and enabled filters — are reproduced here with their
 * asymmetry intact. They look like duplicates and are not:
 *
 * - the **cards** include a character who is switched off (`enabled: false`),
 *   and at `characterDetail: speaker-only` exclude everyone but the speaker;
 * - the **names** exclude a character who is switched off, and at
 *   `speaker-only` exclude everyone — with no exception for the speaker.
 *
 * So a switched-off character can appear in the `characters` blob while being
 * absent from `{{characterNames}}`. Collapsing the two filters into one — the
 * obvious cleanup — changes prompts.
 *
 * ⚠ `characterDetail` replaced the per-character `session_characters.visibility`
 * (retired 2026-09-27): the same three levels, now one genre field for the
 * whole cast rather than a switch per seat. The levels keep the old rules
 * exactly — `brief` is the old *minimal* (name, nickname and description; no
 * personality), `speaker-only` the old *hidden* — so a session that never
 * touched the old switch renders byte for byte what it did.
 */

import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import * as F from "$lib/server/pipelines/prompt/contextFields"
import {
	compileStrokes,
	type ResolvedStroke,
	type StrokeKind
} from "@serene-pub/sdk"
import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"
import { resolveSeedLine } from "$lib/server/pipelines/prompt/seedLine"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
import { likenessOf } from "$lib/server/characters/likeness"
import type { ChannelVoice } from "$lib/server/messages/channels"
import type { BuildContextInput } from "$lib/server/pipelines/prompt/templateContext"

/**
 * How much of a non-speaking character's card the prompt shows — the stored
 * values of the genre field `characterDetail` (Chat, Adventure; 2026-09-27).
 * The speaker's own card is always `full`, whatever the level.
 */
export const CHARACTER_DETAIL = {
	/** Name, nickname, description and personality. The default. */
	FULL: "full",
	/** Name, nickname and description — who they are, not how they behave. */
	BRIEF: "brief",
	/** No card and no name for anyone but the speaker. */
	SPEAKER_ONLY: "speaker-only"
} as const

export type CharacterDetail =
	(typeof CHARACTER_DETAIL)[keyof typeof CHARACTER_DETAIL]

/** A stored value read as a level; anything unrecognised is `full`. */
export function characterDetailOf(value: unknown): CharacterDetail {
	return value === CHARACTER_DETAIL.BRIEF ||
		value === CHARACTER_DETAIL.SPEAKER_ONLY
		? value
		: CHARACTER_DETAIL.FULL
}

export interface SessionCharacterRow {
	/** The seat is switched on in the cast list. Absent reads as on. */
	enabled?: boolean | null
	character: F.CharacterFields & { id?: number }
}

export interface SessionPersonaRow {
	/** The voiced card; 🚧 null for a card-less player seat (2026-10-14). */
	persona: { id?: number; name: string; description: string } | null
	/**
	 * 🚧 The seat's own name — a card-less player seat's only name. On a seat with
	 * a card the read has already laid it over the card's (`withSeatName`).
	 */
	seatName?: string | null
	/** 🚧 Whose seat this is (`session_personas.user_id`), when the read knows. */
	seatUserId?: number | null
}

/** 🚧 A seat's name in the prompt: its card's, else (card-less) its seat name. */
const seatPersonaName = (cp: SessionPersonaRow): string =>
	cp.persona ? F.personaName(cp.persona) : (cp.seatName ?? "")

/** 🚧 A seat's description: the card's; a card-less player seat has none. */
const seatPersonaDescription = (cp: SessionPersonaRow): string =>
	cp.persona ? F.personaDescription(cp.persona) : ""

export interface ResolveInput {
	sessionCharacters?: readonly SessionCharacterRow[]
	sessionPersonas?: readonly SessionPersonaRow[]
	promptConfig: F.PromptConfigFields
	/** Null in no-perspective (narrator) mode. */
	currentCharacterId?: number | null
	/** The session's own scenario, which wins over the character's when set. */
	sessionScenario?: string | null
	isGroup?: boolean
	narratorName?: string
	/**
	 * The cast read's envoys — seated (`envoys`) and declared-only
	 * (`declaredEnvoys`) — for the one thing this resolver takes from them:
	 * the own voice's name on the seed line (lair re-plan R5), which is the
	 * genre's fallback envoy when it declares one.
	 */
	envoys?: ReadonlyArray<{ name?: unknown; fallback?: boolean }>
	declaredEnvoys?: ReadonlyArray<{ name?: unknown; fallback?: boolean }>
	/**
	 * The side character speaking this turn (ruling 2026-09-07) — a
	 * **participant without a turn slot**.
	 *
	 * Read only when `currentCharacterId` names nobody in the cast, which is
	 * the whole of "not a cast member": if the pick happens to be a cast member
	 * the ordinary branch finds them and this is never consulted, so there is
	 * one answer for a speaker rather than two that could disagree.
	 *
	 * It supplies `{{char}}` and the seed line, and nothing else. It is
	 * deliberately **not** added to `characterNames`: that list is the cast
	 * roster — the people this speaker must not write dialogue for — and a
	 * side character is not on it. The shipped side-character prompt says so in
	 * as many words, which it could not if the two collapsed.
	 */
	speakerName?: string | null
	/**
	 * That side character's card, when the trigger picked a real character
	 * rather than typing a name.
	 *
	 * Rendered in full beside the cast's cards, because a model
	 * asked to speak as somebody needs to know who they are — that is what
	 * "first-class presence" means in a prompt. Absent for a free-form name,
	 * where there is no card to render and the name is all there is.
	 */
	speakerCharacter?: (F.CharacterFields & { id?: number }) | null
	/** The narrative graph's two halves, as structure. */
	relationshipsPerspectives?: unknown
	relationshipsKnown?: unknown
	/**
	 * Which example dialogue to use, given how many there are.
	 *
	 * Supplied by the caller so the choice is recorded in the run rather than
	 * rolled inside the prompt build — see `contextFields.characterExampleDialogue`.
	 *
	 * **Defaults to the first, not to a random one.** This resolver is a Task
	 * and a Task is a function of its inputs; a `Math.random()` in here would
	 * make two runs of one pipeline produce two prompts with nothing in the
	 * receipt to explain the difference. The binding seeds this from the run id,
	 * which restores the variety without giving up the replay.
	 */
	pickExample?: (count: number) => number
	/**
	 * The voice of the channel this turn was **triggered on** (R-C,
	 * 2026-09-17) — `narrator` puts the narrator's name on the seed line
	 * whoever is seated, `character` and absence leave it where it was.
	 *
	 * Arrives on the cast read, because that is the one value both this node
	 * and `core:task/process-messages@1` are wired to; the host resolves it
	 * from the turn's channel and the genre's declarations. Absent for every
	 * genre that shapes no channel, which is what keeps the resolved name
	 * byte-identical for them.
	 */
	turnChannelVoice?: ChannelVoice
	/**
	 * The session's `characterDetail` genre field, on the cast read (host,
	 * `case "session_cast"`). Absent — a genre that declares no such field —
	 * is `full`, which is what every character rendered at before it existed.
	 */
	characterDetail?: unknown
	/**
	 * 🚧 Who triggered this run (the host's `scope.userId`, on the cast
	 * read). With several seats it picks `{{user}}`: that person's own seat,
	 * never the joined list (2026-10-16). Absent → the old rule.
	 */
	viewerUserId?: number | null
	/**
	 * 🚧 What the person's own lines are called (`GenreDecl.playerLabel`, or
	 * the session's override — the Lair's *Dungeon Master*), on the cast read.
	 * With no persona to name the person, `{{user}}` is this rather than the
	 * legacy `user` (lair fix 2, 2026-10-22): a delver's turn read the GM's
	 * lines as `user:` while its prompt called them the Dungeon Master's, and
	 * nothing stopped it writing as either. Absent — every genre that
	 * declares no label — the old rule, byte for byte.
	 */
	playerLabel?: string
}

/**
 * Whether a card's strokes were resolved — `core:task/card-strokes@1` ran and
 * stamped `fired` on every one. A raw row's strokes carry no `fired`.
 */
const strokesResolved = (strokes: readonly unknown[]): boolean =>
	strokes.length > 0 &&
	strokes.every(
		(s) => typeof (s as Partial<ResolvedStroke> | null)?.fired === "boolean"
	)

/**
 * The card's strokes as the prompt reads them — none while strokes are paused
 * (`STROKES_ENABLED` off): the prose columns are then the whole card.
 */
const strokesOf = (character: F.CharacterFields) =>
	STROKES_ENABLED ? F.characterStrokes(character) : []

/**
 * One card field, from its strokes when the card is painted in strokes OF
 * THAT KIND, else from its column.
 *
 * Per kind, not per card: a card whose author split only the personality
 * keeps its description column as the truth, rather than losing it to an
 * empty stroke list. Resolved strokes compile `always` + fired only; raw ones
 * compile every enabled stroke — the fallback when no step ran, which loses
 * nothing, only budget (DESIGN-card-strokes A.4).
 */
function strokeField(
	character: F.CharacterFields,
	kind: StrokeKind,
	resolved: boolean
): string | null | undefined {
	const strokes = strokesOf(character)
	if (!strokes.some((s) => s?.kind === kind))
		return kind === "description"
			? F.characterDescription(character)
			: F.characterPersonality(character)
	return compileStrokes(strokes, kind, { firedOnly: resolved })
}

/**
 * The resolved strokes a card carries for a template to address: the fired
 * ones of the kinds this detail level shows, in order — `off` and unfired
 * keyword strokes never, and `brief` drops personality strokes as it drops
 * the field. Empty text is dropped, as `compileStrokes` drops it.
 */
function cardStrokesOf(
	strokes: readonly ResolvedStroke[],
	kinds: readonly StrokeKind[]
): CardStroke[] {
	const out: CardStroke[] = []
	for (const s of strokes) {
		if (!s || s.fired !== true || !kinds.includes(s.kind)) continue
		const text = typeof s.text === "string" ? s.text.trim() : ""
		if (!text) continue
		const label = typeof s.label === "string" ? s.label.trim() : ""
		// Keys in the order `core:var/characters@1` declares them.
		out.push({
			kind: s.kind,
			...(s.slug ? { slug: s.slug } : {}),
			...(label ? { label } : {}),
			text,
			fired: true
		})
	}
	return out
}

/** One stroke as the card carries it — `CHARACTER_CARD.strokes`' item. */
export interface CardStroke {
	kind: StrokeKind
	slug?: string
	label?: string
	text: string
	fired: boolean
}

/** Card data for one character, at the detail they are shown at. */
export function compileCharacter(
	character: F.CharacterFields,
	detail: CharacterDetail
): Record<string, unknown> | null {
	if (detail === CHARACTER_DETAIL.SPEAKER_ONLY) return null

	const card: Record<string, unknown> = {
		name: F.characterName(character),
		nickname: F.characterNickname(character)
	}
	const strokes = strokesOf(character)
	const resolved = strokesResolved(strokes)
	// BRIEF shows who they are and nothing about how they behave.
	card.description = strokeField(character, "description", resolved)
	if (detail !== CHARACTER_DETAIL.BRIEF)
		card.personality = strokeField(character, "personality", resolved)
	// The pieces, for a template that iterates or picks by slug — only once a
	// step resolved them, so a raw card's object is the four fields it was.
	if (resolved)
		card.strokes = cardStrokesOf(
			strokes as ResolvedStroke[],
			detail === CHARACTER_DETAIL.BRIEF
				? ["description"]
				: ["description", "personality"]
		)

	// Dropped rather than left null, because these cards are stringified into
	// the prompt: a `"personality": null` is a line the model reads.
	for (const key of Object.keys(card))
		if (card[key] === undefined || card[key] === null) delete card[key]
	return card
}

export interface ResolvedContextInput extends BuildContextInput {
	/** Which example dialogue was chosen, for the receipt. */
	exampleDialogueIndex: number | null
	/**
	 * The name on the trailing assistant line the model continues from.
	 *
	 * **Not `charName`**, and the difference only shows in narrator mode.
	 * `charName` falls back to the joined cast list; this one falls back to the
	 * narrator's configured name, because the seed primes the model's next turn
	 * — and seeding it with "Alice and Cara:" teaches the model to write joint
	 * dialogue as those characters instead of narrating (index.ts:618-629).
	 */
	seedName: string
}

/**
 * Which of a speaker's example dialogues a session uses — the same one on
 * every turn (B2, 2026-10-03).
 *
 * A hash of the session and the speaker, so the pick is stable without being
 * stored: every turn, regenerate and swipe of one speaker in one session
 * renders the same example, and a different session (or speaker) may land on
 * a different one. The run's `random` answers only when there is no session to
 * key on.
 */
export function stableExamplePick(
	sessionId: unknown,
	characterId: unknown,
	random: () => number
): (count: number) => number {
	if (typeof sessionId !== "number" && typeof sessionId !== "string")
		return (n) => Math.floor(random() * n)
	const key = `${sessionId}:${characterId ?? ""}`
	// FNV-1a, 32-bit: small, dependency-free and stable across processes.
	let h = 0x811c9dc5
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return (n) => (n > 0 ? h % n : 0)
}

/** 🚧 With two or more seats, the viewer's one seat's name; else null. */
function viewerSeatName(
	seats: readonly SessionPersonaRow[],
	viewerUserId: number | null | undefined
): string | null {
	if (seats.length < 2 || viewerUserId == null) return null
	const own = seats.filter(
		(cp) => (cp.seatUserId ?? (cp.persona as { userId?: number } | null)?.userId) === viewerUserId
	)
	return own.length === 1 ? seatPersonaName(own[0]) || null : null
}

export function resolveContextInput(input: ResolveInput): ResolvedContextInput {
	const sessionCharacters = input.sessionCharacters ?? []
	// A row with neither a card nor a seat name is nobody (a departed
	// card's leftover seat).
	const sessionPersonas = (input.sessionPersonas ?? []).filter(
		(cp) => cp.persona || cp.seatName
	)
	const currentId = input.currentCharacterId ?? null
	const current =
		sessionCharacters.find((cc) => cc.character.id === currentId)
			?.character ?? null

	const detail = characterDetailOf(input.characterDetail)

	// Cards: the speaker is always present and always in full.
	const characters = sessionCharacters
		.map((cc) =>
			compileCharacter(
				cc.character,
				cc.character.id === currentId ? CHARACTER_DETAIL.FULL : detail
			)
		)
		.filter(Boolean) as Record<string, unknown>[]

	// The side character's card, first, in full — the same terms the
	// speaking cast member gets. Only when they are genuinely outside the
	// cast: `current` finding them means the loop above already rendered them,
	// and rendering twice would put one person in the prompt as two.
	const sideCard =
		!current && input.speakerCharacter
			? compileCharacter(input.speakerCharacter, CHARACTER_DETAIL.FULL)
			: null
	if (sideCard) characters.unshift(sideCard)

	// Names: switched on, and not at `speaker-only` — no exception for the
	// speaker (the old *hidden* rule, kept exactly).
	const characterNames =
		detail === CHARACTER_DETAIL.SPEAKER_ONLY
			? []
			: sessionCharacters
					.filter((cc) => cc.enabled !== false)
					.map((cc) => resolveCharacterName(cc.character as any))

	const personaNames = sessionPersonas.map(seatPersonaName)

	// 🚧 Likeness (DESIGN-image-generation §5): the speaker's, for
	// `{{likeness}}` / `{{likenessNegative}}` — the side character's when
	// one speaks — and everyone on stage's tag lines for
	// `core:var/likenesses@1`: the switched-on cast, then the personas.
	// Personas are characters (0132), so their rows carry it too.
	const speakerRow = (current ?? input.speakerCharacter ?? null) as
		| Parameters<typeof likenessOf>[0]
		| null
	const speakerLikeness = speakerRow ? likenessOf(speakerRow) : null
	const likenesses = [
		...sessionCharacters
			.filter((cc) => cc.enabled !== false)
			.map((cc) => ({
				name: resolveCharacterName(cc.character as any),
				prompt: likenessOf(cc.character as any).prompt
			})),
		// A card-less player seat has no likeness to draw.
		...sessionPersonas
			.filter((cp) => cp.persona)
			.map((cp) => ({
				name: seatPersonaName(cp),
				prompt: likenessOf(cp.persona as any).prompt
			}))
	]

	// The example dialogue is picked once and reported, so the same run
	// replayed produces the same prompt.
	let exampleDialogueIndex: number | null = null
	const dialogues = Array.isArray(current?.exampleDialogues)
		? (current!.exampleDialogues as unknown[]).filter(Boolean)
		: []
	const exampleDialogue = F.characterExampleDialogue(current, (n) => {
		const chosen = input.pickExample ? input.pickExample(n) : 0
		exampleDialogueIndex = Math.min(Math.max(chosen, 0), n - 1)
		return exampleDialogueIndex
	})
	if (!dialogues.length) exampleDialogueIndex = null

	return {
		characters: characters as any,
		personas: sessionPersonas.map((cp) => ({
			name: seatPersonaName(cp),
			description: seatPersonaDescription(cp)
		})),
		characterNames,
		personaNames,
		likeness: {
			prompt: speakerLikeness?.prompt ?? "",
			negative: speakerLikeness?.negative ?? ""
		},
		likenesses,
		// No single speaker in narrator mode: `{{char}}` becomes the cast list,
		// the same convention `{{characterNames}}` follows (index.ts:623-625).
		// The speaker's name, then the side character's, then the cast list.
		// The middle rung is what makes `{{char}}` mean the shopkeeper on a
		// side-character turn instead of "Alice and Cara" — which is the joined
		// list the no-perspective narrator wants and the one thing a turn
		// spoken by a person must not say.
		charName: current
			? resolveCharacterName(current as any)
			: input.speakerName || joinWithAnd(characterNames),
		// One persona when someone is speaking; the whole list when nobody is.
		// The `"user"` fallback is the legacy default rather than an empty
		// string — a card that says "you are talking to {{user}}" should not
		// render "you are talking to ." (index.ts:630-633).
		// 🚧 Several seats: the triggering person's own seat, when exactly
		// one is theirs — `{{user}}` is one person, never "Ann and Bo".
		personaName:
			viewerSeatName(sessionPersonas, input.viewerUserId) ??
			(current
				? (personaNames[0] ?? (input.playerLabel?.trim() || "user"))
				: joinWithAnd(personaNames)),
		narratorName: input.narratorName,
		scenario: resolveScenario(input, current),
		relationshipsPerspectives: input.relationshipsPerspectives,
		relationshipsKnown: input.relationshipsKnown,
		texts: {
			instructions: F.systemPrompt(input.promptConfig),
			exampleDialogue,
			// The same value as `exampleDialogue` today (index.ts:340), kept as
			// its own field because they render in different places.
			charExampleDialogue: exampleDialogue,
			postHistoryInstructions: F.postHistoryInstructions(
				input.promptConfig,
				current
			),
			promptPostHistoryInstructions: F.promptPostHistoryInstructions(
				input.promptConfig
			),
			charPostHistory: F.charPostHistory(current)
		},
		exampleDialogueIndex,
		// The name half of the seed decision (`prompt/seedLine.ts`). The
		// other half — whether the row is written at all — is read off the
		// same rule by `processMessages`, which is the node that writes it.
		seedName: resolveSeedLine({
			voice: input.turnChannelVoice,
			characterName: current
				? resolveCharacterName(current as any)
				: null,
			speakerName: input.speakerName,
			// The pipeline's own voice (R5): the genre's fallback envoy —
			// seated or only declared, off the cast read — else this
			// prompt's narrator name. English: the prompt is what the
			// model reads, and `en` is the entry every locale map has.
			ownVoiceName: ownVoiceName({
				envoys: [...(input.envoys ?? []), ...(input.declaredEnvoys ?? [])],
				narratorName: input.narratorName
			})
		}).name
	}
}

/**
 * Session scenario, then group-means-none, then the character's.
 *
 * The middle case is not a fallthrough: a group session with no scenario of its
 * own renders **no** scenario rather than one member's, because one member's
 * scenario describes a situation the rest of the cast is not in
 * (index.ts:364-383).
 */
function resolveScenario(
	input: ResolveInput,
	current: F.CharacterFields | null
): string {
	if (input.sessionScenario) return input.sessionScenario
	if (input.isGroup) return ""
	return F.characterScenario(current) ?? ""
}
