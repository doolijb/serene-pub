/**
 * 🚧 The **character profile** (plan §32 §2, §33.1; owner ruling 2026-11-05
 * late, _"Character profile?"_): the one shape a character version holds,
 * card and cast alike. A card version holds a whole profile; a cast version
 * holds its own values and names in `follows` the fields it reads from its
 * parent card version.
 *
 * Always qualified (R3): a bare _profile_ stays the export, docs,
 * image-generation and evidence profiles and the speech dialect's profiles.
 *
 * Owner: "Reconcile what we have for character cards. API should start with
 * the same shape, can update both with what's best. We should also make sure
 * we merge together any fields where there's an arbitrary duplicate like
 * greeting and additional greetings." — so the opener, the alternate
 * greetings and the group-only greetings are ONE list (`greetings`), and the
 * creator notes and their translations are one field (`creatorNotes`).
 *
 * The field names are the `character_versions` column names (drizzle
 * camelCase), so a selected version row is structurally a profile.
 *
 * Pure and leaf: imported by the server's one writer
 * (`server/characters/versions.ts`), the reader (`cast/memberAsRead.ts`) and,
 * later, the client.
 */
import type { Stroke } from "@serene-pub/sdk"
import type { CharacterLikenessInput } from "./likeness"
import type { CharacterTimbreInput } from "./timbre"

/** One greeting. `groupOnly` marks one a group session uses (today's `group_only_greetings`). */
export interface CharacterGreeting {
	text: string
	groupOnly?: boolean
}

/** The creator's notes: the main text, its language when known, and other languages' texts. */
export interface CharacterCreatorNotes {
	text: string
	/** ISO 639-1 code of `text`, when known. */
	lang?: string
	/** Other languages' notes by ISO 639-1 code; never one identical to `text`. */
	variants: Record<string, string>
}

/** 🚧 The character profile. Nullable fields hold no value; lists are never null. */
export interface CharacterProfileV1 {
	name: string | null
	nickname: string | null
	aliases: string[]
	/** A separate optional one-liner; readers fall back to the description's first sentence (§33.1). */
	summary: string | null
	description: string | null
	personality: string | null
	scenario: string | null
	/** Merged: the opener first, then the alternates (empty ones kept: today's swipes), the group-only ones marked. */
	greetings: CharacterGreeting[]
	exampleDialogues: string[]
	postHistoryInstructions: string | null
	creatorNotes: CharacterCreatorNotes | null
	strokes: Stroke[]
	/** The face (a card's avatar, a member's face): a `files` row. */
	faceMediaId: number | null
	likeness: CharacterLikenessInput | null
	timbre: CharacterTimbreInput | null
	/** A sprite set's name; null = the default set. */
	spriteSet: string | null
	/** The card's remaining extension keys (likeness and timbre lifted out). */
	extensions: Record<string, unknown>
}

/** 🚧 Every profile field, in display order. `follows` holds only these. */
export const CHARACTER_PROFILE_FIELDS = [
	"name",
	"nickname",
	"aliases",
	"summary",
	"description",
	"personality",
	"scenario",
	"greetings",
	"exampleDialogues",
	"postHistoryInstructions",
	"creatorNotes",
	"strokes",
	"faceMediaId",
	"likeness",
	"timbre",
	"spriteSet",
	"extensions"
] as const satisfies readonly (keyof CharacterProfileV1)[]

export type CharacterProfileField = (typeof CHARACTER_PROFILE_FIELDS)[number]

export function isCharacterProfileField(
	value: unknown
): value is CharacterProfileField {
	return (
		typeof value === "string" &&
		(CHARACTER_PROFILE_FIELDS as readonly string[]).includes(value)
	)
}

/** A profile with no values: what a followed field reads when its parent is gone. */
export function emptyCharacterProfile(): CharacterProfileV1 {
	return {
		name: null,
		nickname: null,
		aliases: [],
		summary: null,
		description: null,
		personality: null,
		scenario: null,
		greetings: [],
		exampleDialogues: [],
		postHistoryInstructions: null,
		creatorNotes: null,
		strokes: [],
		faceMediaId: null,
		likeness: null,
		timbre: null,
		spriteSet: null,
		extensions: {}
	}
}

/** The profile fields of a row (a version row, or any object with the same names), normalised. */
export function profileOf(
	row: Partial<Record<CharacterProfileField, unknown>>
): CharacterProfileV1 {
	const text = (v: unknown) => (typeof v === "string" ? v : null)
	const texts = (v: unknown) =>
		Array.isArray(v)
			? v.filter((s): s is string => typeof s === "string")
			: []
	const object = <T>(v: unknown): T | null =>
		v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null
	return {
		name: text(row.name),
		nickname: text(row.nickname),
		aliases: texts(row.aliases),
		summary: text(row.summary),
		description: text(row.description),
		personality: text(row.personality),
		scenario: text(row.scenario),
		greetings: Array.isArray(row.greetings)
			? row.greetings
					.filter(
						(g): g is CharacterGreeting =>
							!!g &&
							typeof g === "object" &&
							typeof (g as CharacterGreeting).text === "string"
					)
					.map((g) =>
						g.groupOnly
							? { text: g.text, groupOnly: true }
							: { text: g.text }
					)
			: [],
		exampleDialogues: texts(row.exampleDialogues),
		postHistoryInstructions: text(row.postHistoryInstructions),
		creatorNotes: object<CharacterCreatorNotes>(row.creatorNotes),
		strokes: Array.isArray(row.strokes) ? (row.strokes as Stroke[]) : [],
		faceMediaId:
			typeof row.faceMediaId === "number" ? row.faceMediaId : null,
		likeness: object<CharacterLikenessInput>(row.likeness),
		timbre: object<CharacterTimbreInput>(row.timbre),
		spriteSet: text(row.spriteSet),
		extensions: object<Record<string, unknown>>(row.extensions) ?? {}
	}
}

/**
 * A cast version's profile as read: each field in `follows` from `parent`
 * (the exact parent card version), every other field its own. `parent` null
 * with fields in `follows` (a parent removed by a cascade) reads those fields
 * empty — the caller logs it.
 */
export function followedProfile(
	own: CharacterProfileV1,
	follows: readonly string[],
	parent: CharacterProfileV1 | null
): CharacterProfileV1 {
	if (!follows.length) return own
	const from = parent ?? emptyCharacterProfile()
	const out = { ...own } as Record<CharacterProfileField, unknown>
	for (const field of follows)
		if (isCharacterProfileField(field)) out[field] = from[field]
	return out as unknown as CharacterProfileV1
}

/**
 * The merged greetings from today's three columns (§32 §2): the opener when it
 * is non-empty (`buildCharacterFirstSessionMessage` skips an empty one), then
 * every alternate (empty ones kept: today's swipes), then the group-only ones,
 * marked.
 */
export function mergeGreetings(
	firstMessage: string | null | undefined,
	alternateGreetings: readonly unknown[] | null | undefined,
	groupOnlyGreetings: readonly unknown[] | null | undefined
): CharacterGreeting[] {
	const out: CharacterGreeting[] = []
	if (typeof firstMessage === "string" && firstMessage)
		out.push({ text: firstMessage })
	for (const g of alternateGreetings ?? [])
		if (typeof g === "string") out.push({ text: g })
	for (const g of groupOnlyGreetings ?? [])
		if (typeof g === "string") out.push({ text: g, groupOnly: true })
	return out
}

/**
 * ⏳ The merged greetings in today's three-column shape, for readers not yet
 * moved onto `greetings` (wave 3): the first unmarked greeting is the opener,
 * the other unmarked ones the alternates, the marked ones group-only.
 */
export function legacyGreetingsOf(greetings: readonly CharacterGreeting[]): {
	firstMessage: string | null
	alternateGreetings: string[]
	groupOnlyGreetings: string[]
} {
	const solo = greetings.filter((g) => !g.groupOnly).map((g) => g.text)
	return {
		firstMessage: solo[0] ?? null,
		alternateGreetings: solo.slice(1),
		groupOnlyGreetings: greetings
			.filter((g) => g.groupOnly)
			.map((g) => g.text)
	}
}

/**
 * The merged creator notes from today's two columns: `text` the notes, and
 * `variants` the multilingual map minus any entry identical to `text` (§32
 * §2). Null when there is neither.
 */
export function creatorNotesOf(
	text: string | null | undefined,
	multilingual: Record<string, unknown> | null | undefined
): CharacterCreatorNotes | null {
	const variants: Record<string, string> = {}
	let lang: string | undefined
	for (const [key, value] of Object.entries(multilingual ?? {})) {
		if (typeof value !== "string") continue
		if (text && value === text) {
			lang ??= key
			continue
		}
		variants[key] = value
	}
	if (!text && !Object.keys(variants).length) return null
	return { text: text ?? "", ...(lang ? { lang } : {}), variants }
}

/** A value as stable JSON: object keys sorted, so two equal values print alike. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, (v as Record<string, unknown>)[k]])
				)
			: v
	)
}

/** The profile fields on which two profiles differ, in field order. */
export function profileDifferences(
	a: CharacterProfileV1,
	b: CharacterProfileV1
): CharacterProfileField[] {
	return CHARACTER_PROFILE_FIELDS.filter(
		(field) => stableJson(a[field]) !== stableJson(b[field])
	)
}

/**
 * The suggested label for a card's next version (★CV-4, owner: bump the last
 * number, keeping its form): `1.0` → `1.1`, `1.9` → `1.10`, `v2` → `v3`; null
 * when the label holds no number.
 */
export function nextVersionLabel(
	label: string | null | undefined
): string | null {
	if (!label) return null
	const match = /(\d+)(?!.*\d)/.exec(label)
	if (!match) return null
	const next = String(Number(match[1]) + 1)
	return (
		label.slice(0, match.index) +
		next +
		label.slice(match.index + match[1].length)
	)
}
