/**
 * 🚧 A character's **timbre** — how the character sounds when its lines are
 * spoken (PLAN-speech-connections-and-timbre §4.1; build seam S5). Stored in
 * `characters.extensions.serenepub.timbre`; the shape and the one predicate
 * (`canPickVoice`) are `shared/characters/timbre.ts`.
 *
 * ## Rules
 *
 * - `description`, `language` and `settings` travel
 *   with the card; `voice` and `narrationVoice` (voicebank slugs) are
 *   pub-local and are DROPPED on export and on import.
 * - A socket write is validated and refused with a reason; a card import is
 *   sanitized silently (a bad number is dropped, never a refused card).
 * - Members do not pick voices (A1): without `canPickVoice` the stored
 *   `voice` is kept whatever was sent, which is not an error.
 *
 * Pure but for the voicebank lookup in {@link validateTimbre}.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	TIMBRE_SETTING_KEYS,
	canPickVoice,
	timbreOfExtensions,
	type CharacterTimbreInput,
	type TimbreSettings
} from "$lib/shared/characters/timbre"
import { VOICE_SEED_MAX } from "$lib/shared/speech/voiceTryout"

/** Ceilings and ranges on what a timbre may carry. */
export const TIMBRE_LIMITS = Object.freeze({
	descriptionChars: 2000,
	settings: {
		speed: { min: 0.25, max: 4 },
		stability: { min: 0, max: 1 },
		similarity: { min: 0, max: 1 },
		style: { min: 0, max: 1 },
		seed: { min: 0, max: VOICE_SEED_MAX }
	} as const
})

export type TimbreValidation =
	| { ok: true; timbre: CharacterTimbreInput | null }
	| { ok: false; reason: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

const LANGUAGE = /^[a-z]{2}$/

/** A timbre with nothing in it is "no timbre". */
function orNull(t: CharacterTimbreInput): CharacterTimbreInput | null {
	return Object.keys(t).length ? t : null
}

/**
 * A timbre a socket sent, made safe to store. Refuses (with a reason) a
 * language that is not ISO 639-1, a setting out of range, or a voice that
 * names no voicebank row; unknown keys and non-finite numbers are dropped.
 * Without `ctx.canPickVoice` the `previous.voice` is kept, whatever was sent.
 * `timbre: null` means the key is removed.
 */
export async function validateTimbre(
	input: unknown,
	ctx: { db: Db; canPickVoice: boolean; previous: CharacterTimbreInput }
): Promise<TimbreValidation> {
	if (input === null || input === undefined) {
		// Cleared: members keep the voice they cannot change.
		return {
			ok: true,
			timbre: ctx.canPickVoice
				? null
				: orNull({
						...(ctx.previous.voice ? { voice: ctx.previous.voice } : {}),
						...(ctx.previous.narrationVoice
							? { narrationVoice: ctx.previous.narrationVoice }
							: {})
					})
		}
	}
	if (!isPlainObject(input))
		return { ok: false, reason: "The timbre must be an object." }

	const out: CharacterTimbreInput = {}

	if (input.description !== undefined && input.description !== null) {
		if (typeof input.description !== "string")
			return { ok: false, reason: "The timbre description must be text." }
		const d = input.description.trim()
		if (d.length > TIMBRE_LIMITS.descriptionChars)
			return {
				ok: false,
				reason: `The timbre description is over ${TIMBRE_LIMITS.descriptionChars} characters.`
			}
		if (d) out.description = d
	}

	if (input.language !== undefined && input.language !== null) {
		if (typeof input.language !== "string")
			return { ok: false, reason: "The timbre language must be text." }
		const l = input.language.trim().toLowerCase()
		if (l) {
			if (!LANGUAGE.test(l))
				return {
					ok: false,
					reason: `"${input.language}" is not a two-letter language code (like en or ja).`
				}
			out.language = l
		}
	}

	if (isPlainObject(input.settings)) {
		const settings: TimbreSettings = {}
		for (const k of TIMBRE_SETTING_KEYS) {
			const v = input.settings[k]
			if (typeof v !== "number" || !Number.isFinite(v)) continue
			const { min, max } = TIMBRE_LIMITS.settings[k]
			if (k === "seed" && !Number.isInteger(v))
				return {
					ok: false,
					reason: `Timbre seed must be a whole number from ${min} to ${max}.`
				}
			if (v < min || v > max)
				return {
					ok: false,
					reason: `Timbre ${k} must be between ${min} and ${max}.`
				}
			settings[k] = v
		}
		if (input.settings.speakerBoost !== undefined && input.settings.speakerBoost !== null) {
			if (typeof input.settings.speakerBoost !== "boolean")
				return { ok: false, reason: "Timbre speaker boost must be true or false." }
			settings.speakerBoost = input.settings.speakerBoost
		}
		if (Object.keys(settings).length) out.settings = settings
	}

	if (input.silent !== undefined && input.silent !== null) {
		if (typeof input.silent !== "boolean")
			return { ok: false, reason: "The timbre's silent flag must be true or false." }
		if (input.silent) out.silent = true
	}

	if (!ctx.canPickVoice) {
		if (ctx.previous.voice) out.voice = ctx.previous.voice
		if (ctx.previous.narrationVoice) out.narrationVoice = ctx.previous.narrationVoice
	} else {
		for (const key of ["voice", "narrationVoice"] as const) {
			const sent = input[key]
			if (typeof sent !== "string") continue
			const slug = sent.trim()
			if (!slug) continue
			const row = await ctx.db.query.voicebankVoices.findFirst({
				where: eq(schema.voicebankVoices.slug, slug),
				columns: { id: true }
			})
			if (!row)
				return {
					ok: false,
					reason: `No voice named "${slug}" in the voicebank.`
				}
			out[key] = slug
		}
	}

	return { ok: true, timbre: orNull(out) }
}

/**
 * `extensions` with the timbre set (or removed, for `null`), every other
 * key — ours and another tool's — kept as it was. Never mutates its input.
 */
export function applyTimbreToExtensions(
	extensions: unknown,
	timbre: CharacterTimbreInput | null
): Record<string, unknown> {
	const base = isPlainObject(extensions) ? { ...extensions } : {}
	const sp = isPlainObject(base.serenepub) ? { ...base.serenepub } : {}
	if (timbre && Object.keys(timbre).length) sp.timbre = timbre
	else delete sp.timbre
	if (Object.keys(sp).length) base.serenepub = sp
	else delete base.serenepub
	return base
}

/**
 * The one hook `characters:update` calls: when the save carries `extensions`,
 * validates its `serenepub.timbre` against the stored one and returns the
 * extensions to write. A save whose `serenepub` has no `timbre` key keeps the
 * stored timbre (absent = untouched; send `{}` or null to clear). Throws the
 * refusal reason (the handler's convention: caught, emitted as
 * `characters:update:error`).
 */
export async function applyTimbreUpdate(
	sentExtensions: unknown,
	storedExtensions: unknown,
	ctx: { db: Db; user: { isAdmin?: boolean | null } | null | undefined }
): Promise<Record<string, unknown>> {
	const previous = timbreOfExtensions(storedExtensions)
	const sp = isPlainObject(sentExtensions)
		? (sentExtensions as Record<string, unknown>).serenepub
		: undefined
	if (!(isPlainObject(sp) && "timbre" in sp))
		return applyTimbreToExtensions(
			sentExtensions,
			Object.keys(previous).length ? previous : null
		)
	const result = await validateTimbre(sp.timbre, {
		db: ctx.db,
		canPickVoice: canPickVoice(ctx.user),
		previous
	})
	if (!result.ok) throw new Error(result.reason)
	return applyTimbreToExtensions(sentExtensions, result.timbre)
}

/** What a card carries out: `description`, `language`, `settings` — never `voice` or `narrationVoice`. */
export function timbreForExport(extensions: unknown): {
	description?: string
	language?: string
	settings?: TimbreSettings
	silent?: boolean
} | null {
	const { voice: _pubLocal, narrationVoice: _pubLocalNarration, ...rest } =
		timbreOfExtensions(extensions)
	return Object.keys(rest).length ? rest : null
}

/**
 * The timbre a card brings on import: sanitized, without `voice`; a bad
 * language or an out-of-range setting is dropped silently.
 */
export function timbreFromImport(raw: unknown): CharacterTimbreInput | null {
	if (!isPlainObject(raw)) return null
	const out: CharacterTimbreInput = {}
	if (typeof raw.description === "string") {
		const d = raw.description.trim().slice(0, TIMBRE_LIMITS.descriptionChars)
		if (d) out.description = d
	}
	if (typeof raw.language === "string") {
		const l = raw.language.trim().toLowerCase()
		if (LANGUAGE.test(l)) out.language = l
	}
	if (isPlainObject(raw.settings)) {
		const settings: TimbreSettings = {}
		for (const k of TIMBRE_SETTING_KEYS) {
			const v = raw.settings[k]
			const { min, max } = TIMBRE_LIMITS.settings[k]
			if (k === "seed" && !Number.isInteger(v)) continue
			if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max)
				settings[k] = v
		}
		if (typeof raw.settings.speakerBoost === "boolean")
			settings.speakerBoost = raw.settings.speakerBoost
		if (Object.keys(settings).length) out.settings = settings
	}
	if (raw.silent === true) out.silent = true
	return orNull(out)
}
