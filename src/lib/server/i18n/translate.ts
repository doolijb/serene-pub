/**
 * Machine translation of this app's own UI strings (R5, phase 1b).
 *
 * ## Why a translation *library* and not a translation *catalog*
 *
 * R5 says the starting point is an auto-translate library rather than authored
 * translations, and the reason is arithmetic: every user-visible string in this
 * app is an inline literal in a `.svelte` file, there are thousands of them,
 * and there is no extraction step. Authoring catalogs first would mean the
 * feature ships when the last string is translated — which is to say never.
 *
 * So the English source text *is* the key. A component wraps a literal in
 * `t("Language")`, the client asks for anything it has not seen, and this
 * module answers. Wrapping more strings is the only work required to widen
 * coverage, and an unwrapped string renders in English rather than as a missing
 * key — the failure mode is "not translated yet", never a broken screen.
 *
 * This is explicitly a **starting point**, not the destination. Machine output
 * is worse than a human's, and the design leaves room for a human one: a row in
 * `ui_translations` is looked up before the engine is called, so a hand-written
 * translation inserted for a source string wins permanently.
 *
 * ## The library, and its licence
 *
 * [`translate`](https://github.com/franciscop/translate) v3, **MIT**, chosen
 * over the alternatives for reasons that matter to something shipped as a
 * distributed binary:
 *
 *   - **MIT is compatible with this app's AGPL-3.0 distribution** and imposes
 *     nothing on downstream packagers. `anylang` (Apache-2.0, the successor to
 *     the deprecated `@translate-tools/core`) would also have been fine
 *     licence-wise, at 1.0 MB and six transitive dependencies.
 *   - **Zero runtime dependencies, ~20 kB.** It is a thin client over an HTTP
 *     endpoint, which is genuinely all this needs; it adds no supply-chain
 *     surface to a bundle that ships to end users.
 *   - **It supports LibreTranslate with a caller-supplied URL**, which is what
 *     lets a self-hosted operator get translation without any third party
 *     seeing anything. That was the deciding feature.
 *
 * The engines requiring an API key (`deepl`, `yandex`) are deliberately not
 * offered — see the schema note on `auto_translate_engine`.
 *
 * ## What is sent, and what is never sent
 *
 * Only strings that arrived from a `t()` call in this app's own source, and
 * only when an admin has turned auto-translation on. **No session message, no
 * character, no persona, no lore entry and no user-authored text is ever
 * translated here** — those never pass through `t()`, and the length cap below
 * is a second line of defence against a client trying to smuggle one through.
 */
import { createHash } from "crypto"
import { and, eq, inArray } from "drizzle-orm"
import { Translate } from "translate"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_LANGUAGE } from "$lib/shared/i18n/languages"

/**
 * Longer than any UI string this app has, and far shorter than any user-authored
 * content. A request carrying something longer is not a UI string, so it is
 * dropped rather than translated.
 */
export const MAX_SOURCE_LENGTH = 600

/**
 * How many *uncached* strings one request may translate.
 *
 * The engine is one HTTP round trip per string, so an unbounded batch is an
 * unbounded stall on a shared connection. A screen with more misses than this
 * fills in over the next few requests instead — the client re-asks for what it
 * still lacks, and everything already cached is returned regardless of this
 * cap.
 */
export const MAX_TRANSLATIONS_PER_REQUEST = 40

/** SHA-256 hex of the source text — the cache key. See the schema note. */
export function sourceKey(source: string): string {
	return createHash("sha256").update(source, "utf8").digest("hex")
}

export interface AutoTranslateSettings {
	enabled: boolean
	engine: string
	endpoint: string | null
}

async function autoTranslateSettings(): Promise<AutoTranslateSettings> {
	const row = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: {
			autoTranslateEnabled: true,
			autoTranslateEngine: true,
			autoTranslateEndpoint: true
		}
	})
	return {
		enabled: row?.autoTranslateEnabled ?? false,
		engine: row?.autoTranslateEngine ?? "google",
		endpoint: row?.autoTranslateEndpoint ?? null
	}
}

/**
 * Translate one string, or return null.
 *
 * Separated out so `translateUiStrings`' loop has one thing to await and no
 * error handling of its own — every failure mode of the engine collapses to
 * `null` here, which is the same thing "no translation available" already means
 * everywhere downstream.
 */
export async function translateOne(
	source: string,
	language: string,
	settings: AutoTranslateSettings
): Promise<string | null> {
	try {
		// A fresh instance per call rather than a module-level singleton: the
		// engine and endpoint are admin settings that can change between calls,
		// and the library carries them on the instance, not on the call. It is
		// an object literal beside an HTTP request — the allocation is noise.
		const engine = Translate({
			from: DEFAULT_LANGUAGE,
			to: language,
			engine: settings.engine as "google" | "libre",
			url: settings.endpoint ?? undefined
		} as Parameters<typeof Translate>[0])
		const out = await engine(source)
		if (typeof out !== "string" || out.length === 0) return null
		return out
	} catch (error) {
		// Never rethrows. A translation failure must degrade to English, not
		// break the screen that asked — which is the whole reason `t()` returns
		// its own argument when it has nothing better.
		console.warn(
			`Auto-translation to "${language}" failed:`,
			error instanceof Error ? error.message : error
		)
		return null
	}
}

export interface TranslationResult {
	/** Source text → translation. Absent means "no translation available". */
	entries: Record<string, string>
	/** True when the engine was called, i.e. some rows are new. */
	translated: boolean
}

/**
 * The translations this instance has for `sources`, filling in what it can.
 *
 * Cache first, engine second, and only for what the cache missed. English is
 * answered without touching either: it is the source language, so the identity
 * is the correct translation and storing it would be a table full of `x → x`.
 */
export async function translateUiStrings(
	language: string,
	sources: string[]
): Promise<TranslationResult> {
	if (language === DEFAULT_LANGUAGE) return { entries: {}, translated: false }

	// De-duplicated and filtered before anything is looked up: a client sending
	// the same string twice must not produce two engine calls, and an
	// over-long string is not a UI string at all.
	const wanted = new Map<string, string>()
	for (const source of sources) {
		if (typeof source !== "string") continue
		if (source.length === 0 || source.length > MAX_SOURCE_LENGTH) continue
		wanted.set(sourceKey(source), source)
	}
	if (wanted.size === 0) return { entries: {}, translated: false }

	const cached = await db.query.uiTranslations.findMany({
		where: and(
			eq(schema.uiTranslations.language, language),
			inArray(schema.uiTranslations.sourceKey, [...wanted.keys()])
		),
		columns: { sourceKey: true, source: true, translated: true }
	})

	const entries: Record<string, string> = {}
	for (const row of cached) {
		entries[row.source] = row.translated
		wanted.delete(row.sourceKey)
	}

	const settings = await autoTranslateSettings()
	if (!settings.enabled || wanted.size === 0) {
		return { entries, translated: false }
	}

	let translated = false
	// Sequential, not `Promise.all`. These are unauthenticated calls to a free
	// public endpoint by default; forty at once is what gets an instance rate
	// limited, and the cap above already bounds how long this can take.
	for (const [key, source] of [...wanted].slice(
		0,
		MAX_TRANSLATIONS_PER_REQUEST
	)) {
		const out = await translateOne(source, language, settings)
		if (out === null) continue
		entries[source] = out
		translated = true
		await db
			.insert(schema.uiTranslations)
			.values({
				language,
				sourceKey: key,
				source,
				translated: out,
				engine: settings.engine
			})
			// Two users opening the same screen at once both miss the cache and
			// both translate. Whoever lands second keeps the first one's row —
			// the values are equivalent, and a conflict here must not fail a
			// request that already has its answer in hand.
			.onConflictDoNothing()
	}

	return { entries, translated }
}
