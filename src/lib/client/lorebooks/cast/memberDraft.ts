/**
 * The member form's draft, as arithmetic.
 *
 * The form draws a member as they READ at the moment being read, so the row it
 * is filled from moves whenever the moment, the line or an amendment does.
 * Three facts keep a save honest across that:
 *
 * 1. **The draft remembers what it was built from** (`pristine`). A save
 *    writes `changedFields(draft, pristine)` — what the author changed — and
 *    never the whole resolved row, which would bake other amendments' values
 *    into wherever it landed.
 * 2. **A clean draft follows the row.** Move the moment and an untouched form
 *    re-reads the member as they are then (`draftFollowsRow`); a dirty one is
 *    left alone, and its diff is still only what was typed.
 * 3. **Both halves are one shape** (`memberPatch`), so the diff compares like
 *    with like: an empty summary is `null` on both sides, a missing state is
 *    `"active"` on both.
 */
import { RETOLD_FIELDS, type RetoldFlags } from "$lib/shared/lorebooks/retold"
import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"
import {
	EMPTY_TIMBRE_DRAFT,
	timbreDraftOf,
	timbreOfDraft,
	type TimbreDraft
} from "$lib/client/components/characterForms/voiceTab"
import type { CharacterTimbreInput } from "$lib/shared/characters/timbre"
import type { CharacterLikenessInput } from "$lib/shared/characters/likeness"
import type { CastRow } from "../castPool"
import type { RetoldDraft } from "./retoldRows"

/** The member's own creator notes: the text the form edits, and the language variants it keeps as they came. */
export interface CreatorNotesDraft {
	text: string
	lang?: string
	variants: Record<string, string>
}

/** The likeness the form edits (the shape `LikenessTab` binds). */
export interface LikenessDraft {
	imageMediaId?: number
	prompt: string
	negative: string
}

export interface MemberDraft extends RetoldDraft {
	name: string
	/** The member's own name in this book. `null` = *Use from card* on (the card's reads through); a string = off, the book's own. */
	ownName: string | null
	/** The member's own nickname in this book. `null` = *Use from card* on; a string = off, the book's own; `""` = no nickname in this book. */
	ownNickname: string | null
	aliases: string[]
	summary: string
	nodeState: string
	nodeVisibility: string
	/** Which of the card's sprite sets. "" = the card's default. */
	spriteSet: string
	/** The member's own voice. `null` = the card's voice reads through (or none, card-less); a draft = the member's own. */
	timbre: TimbreDraft | null
	/** The member's own post-history instructions, kept whether or not `retold.postHistoryInstructions` says they are read. */
	postHistoryInstructions: string
	/** The member's own creator notes (`null` = none); the variants ride along untouched. */
	creatorNotes: CreatorNotesDraft | null
	/** The member's own likeness, kept whether or not `retold.likeness` says it is read. */
	likeness: LikenessDraft
}

/** A fresh own-voice draft, for switching *Use from card* off. */
export function emptyOwnTimbre(): TimbreDraft {
	return { ...EMPTY_TIMBRE_DRAFT, settings: {} }
}

/** A row as the wire sends it, with the member's own voice (`CastRow` does not declare the column). */
export type MemberRow = CastRow & {
	timbre?: CharacterTimbreInput | null
	postHistoryInstructions?: string | null
	creatorNotes?: CreatorNotesDraft | null
	likeness?: CharacterLikenessInput | null
}

/** The member's creator notes text. */
export function notesText(draft: Pick<MemberDraft, "creatorNotes">): string {
	return draft.creatorNotes?.text ?? ""
}

/** The draft with its creator notes text changed; the language and variants are kept. */
export function withNotesText<D extends Pick<MemberDraft, "creatorNotes">>(
	draft: D,
	text: string
): D {
	return {
		...draft,
		creatorNotes: { ...(draft.creatorNotes ?? { variants: {} }), text }
	}
}

/** The draft a row reads as. */
export function memberDraftOf(row: MemberRow): MemberDraft {
	return {
		name: row.name ?? "",
		// A blank own name is never stored; it reads as *Use from card* on.
		ownName: ownNameValue(row.ownName) || null,
		// A stored "" reads as off and blank (no nickname in this book).
		ownNickname: row.ownNickname ?? null,
		aliases: [...(row.aliases ?? [])],
		summary: row.summary ?? "",
		nodeState: row.nodeState || "active",
		nodeVisibility: row.nodeVisibility || "normal",
		spriteSet: row.spriteSet ?? "",
		timbre: row.timbre
			? timbreDraftOf({ serenepub: { timbre: row.timbre } })
			: null,
		postHistoryInstructions: row.postHistoryInstructions ?? "",
		creatorNotes: row.creatorNotes
			? {
					text: row.creatorNotes.text,
					...(row.creatorNotes.lang !== undefined
						? { lang: row.creatorNotes.lang }
						: {}),
					variants: { ...row.creatorNotes.variants }
				}
			: null,
		likeness: {
			...(row.likeness?.imageMediaId !== undefined
				? { imageMediaId: row.likeness.imageMediaId }
				: {}),
			prompt: row.likeness?.prompt ?? "",
			negative: row.likeness?.negative ?? ""
		},
		description: row.description ?? "",
		personality: row.personality ?? "",
		scenario: row.scenario ?? "",
		firstMessage: row.firstMessage ?? "",
		alternateGreetings: [...(row.alternateGreetings ?? [])],
		groupOnlyGreetings: [...(row.groupOnlyGreetings ?? [])],
		exampleDialogues: row.exampleDialogues ?? "",
		faceMediaId: row.faceMediaId ?? null,
		retold: { ...(row.retold ?? {}) }
	}
}

/**
 * The flags as one canonical shape: only the fields that ARE retold, in
 * canonical order. `false` and absent both mean "the card's", so a row that
 * says `{ face: false }` and a draft that says `{}` write the same thing.
 */
export function canonicalRetold(flags: RetoldFlags | null | undefined) {
	const out: RetoldFlags = {}
	for (const field of RETOLD_FIELDS)
		if (flags?.[field] === true) out[field] = true
	return out
}

/** Empty text is NULL on the row, as the summary is. */
function textOrNull(value: string): string | null {
	return value.trim() ? value : null
}

/**
 * The member's own words for the card's prose fields: description,
 * personality, scenario, greetings and example dialogues. A carded member
 * retells them (`retoldPatch`); a card-less member's are simply theirs.
 */
function wordsPatch(draft: RetoldDraft): Record<string, unknown> {
	return {
		description: textOrNull(draft.description),
		personality: textOrNull(draft.personality),
		scenario: textOrNull(draft.scenario),
		firstMessage: textOrNull(draft.firstMessage),
		// Every greeting as typed: an empty one is a swipe (§33.1), not nothing.
		alternateGreetings: [...draft.alternateGreetings],
		groupOnlyGreetings: [...draft.groupOnlyGreetings],
		exampleDialogues: textOrNull(draft.exampleDialogues)
	}
}

/**
 * The retold half of a patch — a carded member's own words for the card's
 * fields, their face, and which of them are read.
 *
 * ⚠ Every field is written whether or not it is retold: switching a field
 * back to the card keeps the member's text (hidden, never discarded), so the
 * text must survive a save made while the toggle is off.
 */
export function retoldPatch(draft: RetoldDraft): Record<string, unknown> {
	return {
		...wordsPatch(draft),
		faceMediaId: draft.faceMediaId ?? null,
		retold: canonicalRetold(draft.retold)
	}
}

/** The creator notes a draft writes: none when there is no text and no variant. */
function notesOf(notes: CreatorNotesDraft | null) {
	if (!notes) return null
	if (!notes.text.trim() && !Object.keys(notes.variants).length) return null
	return {
		text: notes.text,
		...(notes.lang !== undefined ? { lang: notes.lang } : {}),
		variants: { ...notes.variants }
	}
}

/** The likeness a draft writes: none when it holds nothing. */
function likenessOf(l: LikenessDraft): CharacterLikenessInput | null {
	const prompt = l.prompt.trim()
	const negative = l.negative.trim()
	if (l.imageMediaId === undefined && !prompt && !negative) return null
	return {
		...(l.imageMediaId !== undefined
			? { imageMediaId: l.imageMediaId }
			: {}),
		...(prompt ? { prompt } : {}),
		...(negative ? { negative } : {})
	}
}

/**
 * The own voice a draft writes, or null for "the card's" (or none).
 * Every part is written, `voice` too: the member's saved voice round-trips
 * whole, and the picker that changes it is the admin's.
 */
function ownTimbreOf(draft: TimbreDraft | null): CharacterTimbreInput | null {
	if (!draft) return null
	const t = timbreOfDraft(draft, { canPickVoice: true })
	return Object.keys(t).length ? t : null
}

/**
 * What a draft writes — to the member or to a date.
 *
 * A carded member's NAME is the card's unless the book gives them one: the
 * synced `name` column is not in the patch, but `ownName` / `ownNickname`
 * are (`null` = *Use from card* on = the card's; text = the book's own, shown in
 * this book only; an own `""` nickname = no nickname in this book). Their aliases are the MEMBER's (#114, cast-first):
 * editable for every member, and a card sync merges the card's names in
 * rather than writing over them.
 *
 * Only a carded member has retold fields (`retoldPatch`): which of the card's
 * fields it reads, and its face. A card-less member has no card to follow, so
 * its description, personality, scenario, greetings and example dialogues are
 * simply its own (`wordsPatch`), with no flags (`memberProfileOf`: card-less,
 * every field is own).
 */
export function memberPatch(
	draft: MemberDraft,
	linked: boolean
): Record<string, unknown> {
	return {
		summary: draft.summary.trim() || null,
		nodeState: draft.nodeState,
		nodeVisibility: draft.nodeVisibility,
		// ⚠ Empty means "the card's default set", which is NULL on the row —
		// not the empty string, which would be a set nothing is named.
		spriteSet: draft.spriteSet || null,
		aliases: [...draft.aliases],
		// An own voice with nothing in it is no own voice: NULL on the row.
		timbre: ownTimbreOf(draft.timbre),
		// Written whether or not the card's are read (kept, never discarded), and
		// for a card-less member too: their own is all they have.
		postHistoryInstructions: textOrNull(draft.postHistoryInstructions),
		creatorNotes: notesOf(draft.creatorNotes),
		likeness: likenessOf(draft.likeness),
		...(linked
			? {
					ownName: ownNameValue(draft.ownName),
					ownNickname: ownNameValue(draft.ownNickname),
					...retoldPatch(draft)
				}
			: { name: draft.name.trim(), ...wordsPatch(draft) })
	}
}

/** Whether two drafts would write the same thing. */
export function sameMemberDraft(
	a: MemberDraft,
	b: MemberDraft,
	linked: boolean
): boolean {
	return (
		JSON.stringify(memberPatch(a, linked)) ===
		JSON.stringify(memberPatch(b, linked))
	)
}

/**
 * Whether the form should re-read the row it is drawn from.
 *
 * Only a CLEAN draft follows: edits in flight are never discarded to follow a
 * reading. The row has moved when it differs from the reading the draft was
 * built from.
 */
export function draftFollowsRow(opts: {
	draft: MemberDraft
	pristine: MemberDraft
	row: CastRow
	linked: boolean
}): boolean {
	const { draft, pristine, row, linked } = opts
	if (!sameMemberDraft(draft, pristine, linked)) return false
	return !sameMemberDraft(memberDraftOf(row), pristine, linked)
}
