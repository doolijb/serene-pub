/**
 * **Retold fields** at the read seams (PLAN-cast-retold-fields-2026-10-13).
 *
 * What is left here: `splitExampleDialogues`, `faceMediaProblem`,
 * `retoldUpdateProblem`, and the member form's column shape of a version
 * (`memberColumnsOfVersion`, `castChangesOfMemberEdit`). A seat reads its
 * member from the member's character version (`cast/memberAsRead.ts`); the
 * frozen member columns are read nowhere.
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle (the `castMemberCards` rule).
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"
import {
	parseRetoldFlags,
	RETOLD_TEXT_FIELDS,
	type RetoldFlags
} from "$lib/shared/lorebooks/retold"
import {
	memberProfileOf,
	type CastVersionChanges
} from "$lib/server/characters/versions"
import {
	legacyGreetingsOf,
	profileOf,
	type CharacterCreatorNotes,
	type CharacterProfileField,
	type CharacterProfileV1
} from "$lib/shared/characters/profile"
import type { CharacterLikenessInput } from "$lib/shared/characters/likeness"
import type { CharacterTimbreInput } from "$lib/shared/characters/timbre"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"

/** A member's example-dialogue text as the card shape: one entry per `<START>`. */
export function splitExampleDialogues(text: unknown): string[] {
	if (typeof text !== "string") return []
	return text
		.split("<START>")
		.map((d) => d.trim())
		.filter((d) => d !== "")
}

/**
 * Why a file cannot be a member's face, or null when it can: the asker's own
 * upload for this book (`files.lorebook_id`), or a gallery image of the
 * member's card (`files.character_id`).
 */
export async function faceMediaProblem(
	db: Db,
	opts: {
		fileId: number
		lorebookId: number
		/** A card this change itself links (a dated card swap), if any. */
		characterId: number | null
		/**
		 * The member, so a gallery image of ANY card they are drawn with — on
		 * any line, at any date — may be worn. A dated card "is the member's,
		 * on any line and at any date" (NOMENCLATURE, dated card); judging
		 * only the stored card refused a face picked while reading a date
		 * whose card was swapped (review 2026-10-13).
		 */
		memberId?: number | null
		userId: number
	}
): Promise<string | null> {
	const refusal =
		"That picture is not one this cast member can wear: use a picture from their card's gallery, or upload one to this lorebook."
	if (!Number.isInteger(opts.fileId) || opts.fileId <= 0) return refusal
	const [file] = await db
		.select({
			userId: schema.files.userId,
			lorebookId: schema.files.lorebookId,
			characterId: schema.files.characterId,
			kind: schema.files.kind,
			visibility: schema.files.visibility
		})
		.from(schema.files)
		.where(eq(schema.files.id, opts.fileId))
		.limit(1)
	if (!file || file.kind !== "image") return refusal
	// The asker's own picture (an upload to this book — or the row an upload
	// re-used, since files are one row per user and bytes): theirs to show,
	// unless it is private, which nobody else could see as a face.
	if (file.userId === opts.userId && file.visibility !== MediaVisibility.PRIVATE)
		return null
	if (file.characterId == null) return refusal
	if (opts.characterId != null && file.characterId === opts.characterId)
		return null
	if (opts.memberId != null) {
		const { castMemberCards } = await import(
			"$lib/server/utils/castMemberCards"
		)
		const { cardsOf } = await castMemberCards(db, opts.lorebookId)
		if ((cardsOf.get(opts.memberId) ?? []).includes(file.characterId))
			return null
	}
	return refusal
}

/**
 * Why a member edit's retold columns cannot be written, or null — the
 * `lorebooks:updateBinding` check. Text is text, the other greetings are a
 * list of text, `retold` is flags over retold fields, and a NEW face must be
 * one the asker may use (`faceMediaProblem`); the member's current face is
 * never re-judged. Normalises `retold` in place.
 */
export async function retoldUpdateProblem(
	db: Db,
	update: Record<string, unknown>,
	member: {
		id: number
		lorebookId: number
		characterId: number | null
		faceMediaId: number | null
	},
	userId: number
): Promise<string | null> {
	const words = {
		description: "description",
		personality: "personality",
		scenario: "scenario",
		firstMessage: "first message",
		exampleDialogues: "example dialogues"
	} as const
	for (const field of RETOLD_TEXT_FIELDS) {
		const v = update[field]
		if (v !== undefined && v !== null && typeof v !== "string")
			return `A cast member's ${words[field]} is text.`
	}
	if (
		update.alternateGreetings !== undefined &&
		!(
			Array.isArray(update.alternateGreetings) &&
			update.alternateGreetings.every((g) => typeof g === "string")
		)
	)
		return "A cast member's other greetings are a list of greetings."
	if (
		update.groupOnlyGreetings !== undefined &&
		!(
			Array.isArray(update.groupOnlyGreetings) &&
			update.groupOnlyGreetings.every((g) => typeof g === "string")
		)
	)
		return "A cast member's group-only greetings are a list of greetings."
	if (update.retold !== undefined) {
		const parsed = parseRetoldFlags(update.retold)
		if (!parsed.ok) return parsed.error
		update.retold = parsed.retold
	}
	const face = update.faceMediaId
	if (face !== undefined && face !== null && face !== member.faceMediaId) {
		if (typeof face !== "number")
			return "That picture is not one this cast member can wear."
		const problem = await faceMediaProblem(db, {
			fileId: face,
			lorebookId: member.lorebookId,
			characterId: member.characterId,
			memberId: member.id,
			userId
		})
		if (problem) return problem
	}
	return null
}

// ── A cast version, in the member form's column names ─────────────────────

/**
 * ⏳ A cast version in the member row's column names, until the client reads
 * versions (wave 3): what `memberColumnsOfVersion` answers and the member form
 * sends back.
 */
export interface MemberColumnsOfVersion {
	/** A card-less member's name; null for a carded one (its name is `ownName` or the card's). */
	name: string | null
	aliases: string[]
	summary: string | null
	description: string | null
	personality: string | null
	scenario: string | null
	firstMessage: string | null
	alternateGreetings: string[]
	/** The version's own greetings marked for group sessions only. */
	groupOnlyGreetings: string[]
	exampleDialogues: string | null
	faceMediaId: number | null
	retold: RetoldFlags
	ownName: string | null
	ownNickname: string | null
	timbre: CharacterTimbreInput | null
	spriteSet: string | null
	/** The version's own post-history instructions, kept while the field follows the card. */
	postHistoryInstructions: string | null
	/** The version's own creator notes, kept while the field follows the card. */
	creatorNotes: CharacterCreatorNotes | null
	/** The version's own likeness, kept while the field follows the card. */
	likeness: CharacterLikenessInput | null
	nodeState: NodeState
	nodeVisibility: NodeVisibility
}

/** Each retold flag's profile field: a field is retold when its profile field is not followed. */
const RETOLD_PROFILE_FIELD: Record<
	keyof Required<RetoldFlags>,
	CharacterProfileField
> = {
	description: "description",
	personality: "personality",
	scenario: "scenario",
	firstMessage: "greetings",
	alternateGreetings: "greetings",
	exampleDialogues: "exampleDialogues",
	face: "faceMediaId",
	postHistoryInstructions: "postHistoryInstructions",
	creatorNotes: "creatorNotes",
	likeness: "likeness"
}

/** A member's example dialogues as ONE text: each dialogue opened with `<START>` (the form's join). */
function joinExampleDialogues(dialogues: readonly string[]): string | null {
	const texts = dialogues.map((d) => d.trim()).filter(Boolean)
	return texts.length ? texts.map((d) => `<START>\n${d}`).join("\n\n") : null
}

/**
 * 🚧 ⏳ A cast version in the member row's column names (the one mapping from
 * a version to the member form). A text field is the version's own column
 * even while the field is followed (toggling off hides, never discards); a
 * field is **retold** exactly when its profile field is not in `follows`.
 * A card-less version (`carded: false`) has no retold flags and no own names:
 * its columns are simply its own, `name` included.
 */
export function memberColumnsOfVersion(
	version: Partial<Record<CharacterProfileField, unknown>> & {
		follows: readonly string[]
		nodeState: NodeState | null
		nodeVisibility: NodeVisibility | null
	},
	opts: { carded: boolean }
): MemberColumnsOfVersion {
	const profile = profileOf(version)
	const follows = new Set<string>(version.follows)
	const greetings = legacyGreetingsOf(profile.greetings)
	const retold: RetoldFlags = {}
	if (opts.carded)
		for (const [flag, field] of Object.entries(RETOLD_PROFILE_FIELD))
			if (!follows.has(field)) retold[flag as keyof RetoldFlags] = true
	return {
		name: opts.carded ? null : profile.name,
		aliases: profile.aliases,
		summary: profile.summary,
		description: profile.description,
		personality: profile.personality,
		scenario: profile.scenario,
		firstMessage: greetings.firstMessage,
		alternateGreetings: greetings.alternateGreetings,
		groupOnlyGreetings: greetings.groupOnlyGreetings,
		exampleDialogues: joinExampleDialogues(profile.exampleDialogues),
		faceMediaId: profile.faceMediaId,
		retold,
		ownName: opts.carded && !follows.has("name") ? profile.name : null,
		// An own empty nickname is "no nickname in this book" (★L-3b).
		ownNickname:
			opts.carded && !follows.has("nickname")
				? (profile.nickname ?? "")
				: null,
		timbre: profile.timbre,
		spriteSet: profile.spriteSet,
		postHistoryInstructions: profile.postHistoryInstructions,
		creatorNotes: profile.creatorNotes,
		likeness: profile.likeness,
		nodeState: version.nodeState ?? "active",
		nodeVisibility: version.nodeVisibility ?? "normal"
	}
}

/** Two values as equal JSON, object keys in any order. */
function sameValue(a: unknown, b: unknown): boolean {
	const stable = (v: unknown) =>
		JSON.stringify(v ?? null, (_k, x) =>
			x && typeof x === "object" && !Array.isArray(x)
				? Object.fromEntries(
						Object.keys(x)
							.sort()
							.map((k) => [k, (x as Record<string, unknown>)[k]])
					)
				: x
		)
	return stable(a) === stable(b)
}

/**
 * 🚧 The cast-version changes a member-form edit means, or null when nothing
 * changed. `after` is converted by `memberProfileOf` — the conversion the base
 * insert and the boot lift use — and only the profile fields the edit
 * **touched** (one of their member-column inputs differs) are emitted: a
 * touched field the conversion follows is `{ follow: true }`, any other its
 * own value. `card` is the parent card version's profile (null = card-less).
 */
export function castChangesOfMemberEdit(
	before: MemberColumnsOfVersion & { characterId: number | null },
	after: MemberColumnsOfVersion & { characterId: number | null },
	card: CharacterProfileV1 | null
): CastVersionChanges | null {
	const { own, follows } = memberProfileOf(
		{ ...after, name: after.name ?? "" },
		card
	)
	const flag = (m: MemberColumnsOfVersion, f: keyof RetoldFlags) =>
		m.retold?.[f] === true
	const differs = (...keys: (keyof MemberColumnsOfVersion)[]) =>
		keys.some((k) => !sameValue(before[k], after[k]))
	const flagsDiffer = (...flags: (keyof RetoldFlags)[]) =>
		flags.some((f) => flag(before, f) !== flag(after, f))

	const touched = new Set<CharacterProfileField>()
	if (after.characterId != null ? differs("ownName") : differs("name"))
		touched.add("name")
	if (differs("ownNickname")) touched.add("nickname")
	if (differs("aliases")) touched.add("aliases")
	if (differs("summary")) touched.add("summary")
	for (const field of ["description", "personality", "scenario"] as const)
		if (differs(field) || flagsDiffer(field)) touched.add(field)
	if (
		differs("firstMessage", "alternateGreetings", "groupOnlyGreetings") ||
		flagsDiffer("firstMessage", "alternateGreetings")
	)
		touched.add("greetings")
	if (differs("exampleDialogues") || flagsDiffer("exampleDialogues"))
		touched.add("exampleDialogues")
	if (differs("faceMediaId") || flagsDiffer("face"))
		touched.add("faceMediaId")
	if (differs("timbre")) touched.add("timbre")
	if (differs("spriteSet")) touched.add("spriteSet")
	for (const field of [
		"postHistoryInstructions",
		"creatorNotes",
		"likeness"
	] as const)
		if (differs(field) || flagsDiffer(field)) touched.add(field)

	const changes: Record<string, unknown> = {}
	for (const field of touched)
		changes[field] = follows.includes(field) ? { follow: true } : own[field]
	if (before.nodeState !== after.nodeState)
		changes.nodeState = after.nodeState
	if (before.nodeVisibility !== after.nodeVisibility)
		changes.nodeVisibility = after.nodeVisibility
	return Object.keys(changes).length ? (changes as CastVersionChanges) : null
}
