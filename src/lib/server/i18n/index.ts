/**
 * Which language is this user in, and what can that language do?
 *
 * `PLAN-retrieval-and-knowledge.md` §7 **R5**, phase 1b. This module is small
 * on purpose: it is the one place that knows the resolution chain, and it
 * exists so that nothing else has to.
 *
 * ## The resolution chain
 *
 *     user_settings.language  →  system_settings.default_language  →  "en"
 *
 * NULL at the user end means *"whatever the instance default is"*, not English.
 * That is what makes the admin's setup choice apply to everybody who never
 * expressed a preference, and what makes changing it later move them. Reading
 * either column alone gives the wrong answer, which is why they are read here
 * together and nowhere apart.
 *
 * A stored code the current build no longer offers resolves to English rather
 * than throwing — an install downgraded across a release that dropped a
 * language keeps working instead of failing to load its settings.
 *
 * ## For the lexical mechanism
 *
 * The feature question is `languageSupports(code, "stemming")` — pure,
 * synchronous, no database, re-exported below so a caller needs one import.
 * Ask this module *which* language once per run, then ask that function as
 * often as you like.
 *
 *     const { code } = await resolveUserLanguage(userId)
 *     const stem = languageSupports(code, "stemming")
 *
 * **Nothing in `pipelines/ranking/` reads this yet, and that is deliberate.**
 * Wiring stemming is a separate change; this is the setting it will read.
 */
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	DEFAULT_LANGUAGE,
	languageDefinition,
	type LanguageDefinition
} from "$lib/shared/i18n/languages"

export {
	DEFAULT_LANGUAGE,
	LANGUAGES,
	isSupportedLanguage,
	languageDefinition,
	languageSupports,
	type LanguageDefinition,
	type LanguageFeatures
} from "$lib/shared/i18n/languages"

export interface ResolvedLanguage {
	/** ISO 639-1. Safe to hand to `<html lang>` and to the translate engine. */
	code: string
	definition: LanguageDefinition
	/**
	 * Where the answer came from.
	 *
	 * Not decoration: it is the difference between "this user chose Spanish"
	 * and "this user inherited Spanish", which is exactly what the settings UI
	 * needs to decide whether its picker shows a choice or a default — and what
	 * a receipt needs to explain why a run stemmed or did not.
	 */
	source: "user" | "instance" | "fallback"
}

function resolved(
	code: string | null | undefined,
	source: ResolvedLanguage["source"]
): ResolvedLanguage {
	const definition = languageDefinition(code)
	// Read the code back off the definition rather than trusting the input:
	// that is what collapses an unknown stored code onto English in one place
	// instead of at every call site.
	return { code: definition.code, definition, source }
}

/** The instance default — the language a user with no preference gets. */
export async function resolveInstanceLanguage(): Promise<ResolvedLanguage> {
	const row = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { defaultLanguage: true }
	})
	// No settings row at all is a pre-seed boot, not a corrupted install —
	// `defaults.ts` inserts it. English until it does.
	if (!row?.defaultLanguage) return resolved(DEFAULT_LANGUAGE, "fallback")
	return resolved(row.defaultLanguage, "instance")
}

/**
 * The effective language for one user.
 *
 * Two queries rather than a join: `user_settings` may legitimately have no row
 * yet (it is created lazily on first `userSettings:get`), and a join would make
 * that indistinguishable from a user with no preference — which needs the
 * instance default, not the fallback.
 */
export async function resolveUserLanguage(
	userId: number
): Promise<ResolvedLanguage> {
	const row = await db.query.userSettings.findFirst({
		where: eq(schema.userSettings.userId, userId),
		columns: { language: true }
	})
	if (row?.language) return resolved(row.language, "user")
	return resolveInstanceLanguage()
}
