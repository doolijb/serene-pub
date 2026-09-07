/**
 * HOW MANY, HOW BIG, and IN WHAT FORMAT — the cardinality half of an adapter
 * entry.
 *
 * ## Why this is not a change to the transform vocabulary
 *
 * Multi-file support is a **cardinality-and-limits attribute on the registrar
 * entry, not a widening of the transform vocabulary.** `text+image->text` is a
 * set of KINDS: it says images may travel in alongside text, and it cannot say
 * how many, because `[image, image] -> [text]` is meaningless as a set — a set
 * has no multiplicity. Trying to express counts there would either duplicate a
 * kind (nonsense) or introduce a second id space that resolution, the picker
 * and every stored `CapabilitySet` would have to learn.
 *
 * So counts, byte caps and format lists ride ALONGSIDE the capability grades,
 * per adapter, in this shape. `supports` says WHETHER a kind may flow; this says
 * HOW MUCH of it, and in which spellings.
 *
 * ## ⚠ ABSENT MEANS "NO KNOWN LIMIT". It never means zero.
 *
 * This is the single most important rule in the file, and it is the one a reader
 * gets backwards. A missing count is an UNKNOWN — nobody has published a number,
 * or nobody has gone and read it — and an unknown must not block, because the
 * cost of the two mistakes is wildly asymmetric:
 *
 *   - A cap that is absent when one exists costs one failed API call, with the
 *     backend's own error message naming the real limit.
 *   - A cap that is present and wrong REFUSES WORK THE BACKEND WOULD HAVE
 *     ACCEPTED, from inside this app, with a message that sounds authoritative.
 *
 * A zero would be the worst version of the second: it refuses everything, and it
 * is exactly what a `?? 0` default or a "let's initialise the fields" edit
 * produces. Three things hold the rule:
 *
 *   1. Every reader here treats `undefined` as permissive — see `withinCap`,
 *      which is the ONE comparison and returns true for an absent cap.
 *   2. A cap cannot be written as a bare number. It is built by `cap()`, which
 *      demands the SOURCE alongside the number, and whose `0` overload returns a
 *      sentence instead of a `Cap` — so `cap(0, …)` is a compile error that
 *      reads as the fix.
 *   3. `io.test.ts` walks every declared cap and fails on anything that is not a
 *      positive integer, and asserts the absent case is permissive rather than
 *      trusting the comment above.
 *
 * ## ⚠ Do not invent a number
 *
 * `source` is required on every cap, and it is not decoration: it is the thing
 * that makes "did somebody read this in a doc, or guess it?" answerable a year
 * from now, and it is what a refusal quotes so a user can go and check. An
 * adapter whose service publishes nothing declares NOTHING — which is why most
 * entries in `ADAPTER_MANIFEST` carry no `io` block at all, and why that is the
 * correct state rather than an unfinished one.
 *
 * ## Formats come from the format table, never re-spelled
 *
 * `accepts` and `prefers` are `KnownMime`, the union of the mimes
 * `$lib/shared/media/formats` declares. So a format list names table entries: a
 * typo or a non-canonical alias (`image/jpg`) is a compile error where it was
 * written, and the alias handling stays in `normalizeMime` where it already is
 * rather than being repeated per adapter.
 *
 * Browser-safe, like everything else in `$lib/shared`: the file picker that will
 * offer `accepts` to a person renders in a browser, and the enforcement engine
 * that reads the same declarations (`$lib/server/adapters/attachments`) is the
 * half that carries the codecs.
 */

import {
	MEDIA_KINDS,
	normalizeMime,
	type KnownMime,
	type MediaKind
} from "$lib/shared/media/formats"

// ── A cap ───────────────────────────────────────────────────────────────────

/**
 * A limit somebody actually published, and where.
 *
 * An object rather than a number so the citation travels WITH the value instead
 * of in a comment beside it. Two things need it: a refusal, which can then say
 * "Anthropic's vision documentation gives 100 images per request" rather than
 * "too many images"; and the next reader, who has to be able to tell a sourced
 * number from a plausible one without a git blame.
 */
export interface Cap {
	/** The most that is allowed. Inclusive: `max` itself is fine. */
	readonly max: number
	/** Where this number comes from, in words. Never empty. */
	readonly source: string
}

/**
 * The compile error for `cap(0, …)`. The type IS the explanation, which is the
 * whole trick: TypeScript prints it verbatim at the declaration site.
 */
type ZeroIsNotACap =
	"A cap of 0 refuses every file. Absent means NO KNOWN LIMIT here — omit the field instead of declaring zero."

/**
 * Declare a cap. `cap(100, "Anthropic's vision docs, …")`.
 *
 * The `0` overload is the type-level half of the absent-is-not-zero rule: `0`
 * matches that overload exactly, its return type is a sentence, and a sentence
 * is not assignable to `Cap` — so the mistake fails to compile where it was
 * typed rather than silently refusing every request at runtime. A non-literal
 * `number` falls through to the second overload, which is why the runtime check
 * in `io.test.ts` exists as well: this catches the literal, that catches the
 * rest.
 *
 * Deliberately total and non-throwing for every other input. The manifest is
 * evaluated at import, in the client bundle as well as on the server, so a throw
 * here would take a page down over an authoring mistake — the same reason
 * `gradeOf` clamps instead of throwing. A test is what fails the build.
 */
export function cap(max: 0, source: string): ZeroIsNotACap
export function cap(max: number, source: string): Cap
export function cap(max: number, source: string): Cap | ZeroIsNotACap {
	// One body for both faces. The `0` overload never reaches a different code
	// path — its whole job is done at compile time, and the object it would
	// return at runtime is why the conformance walk in `io.test.ts` exists too.
	return { max, source }
}

/**
 * THE comparison. `true` when nothing is declared.
 *
 * Every count and byte check goes through this rather than reading `.max`
 * directly, so "absent is permissive" is implemented once and cannot be
 * forgotten at the fourth call site.
 */
export const withinCap = (value: number, limit: Cap | undefined): boolean =>
	limit === undefined || value <= limit.max

// ── What an entry declares ──────────────────────────────────────────────────

/**
 * The limits on ONE input kind.
 *
 * Per kind because the answers genuinely differ per kind on the same backend:
 * Anthropic takes a hundred images and a much smaller number of much larger
 * PDFs, and one shared "max files" would have to be wrong for one of them.
 */
export interface InputLimits {
	/** How many files of this kind one request may carry. */
	maxFiles?: Cap
	/**
	 * How many bytes ONE file of this kind may be, AS PUBLISHED.
	 *
	 * ⚠ Measured on what the service RECEIVES, not on the file as stored. The
	 * published numbers are about the encoded payload wherever the API inlines
	 * one — Anthropic's vision docs give the per-image limit as "10 MB
	 * (base64-encoded)" in as many words — and base64 is four characters per
	 * three bytes, so a 10MB cap is an effective ceiling of 7.5MB on the file.
	 *
	 * Declare the number the documentation gives and let the adapter's
	 * `transport` do that arithmetic (`prepareAttachments`, which applies it to
	 * this cap and to `maxRequestBytes` alike). Pre-multiplying here would put
	 * the same fact in two places and make this field disagree with its own
	 * `source`.
	 *
	 * If a service ever publishes a per-file limit about the FILE while inlining
	 * base64, declare three quarters of its number with a `source` saying so —
	 * the transport is a property of the wire, not a per-cap switch.
	 */
	maxBytesPerFile?: Cap
	/**
	 * The mimes the backend will take for this kind, as PUBLISHED.
	 *
	 * Absent means no declared allow-list, which is a statement about our
	 * knowledge and not about the backend: a file of this kind is forwarded
	 * untouched rather than converted, because negotiating against a list we
	 * invented would re-encode files the backend was happy with.
	 *
	 * ⚠ This never grants or refuses a KIND. Whether images may flow at all is
	 * `supports`'s answer (`text+image->text`), resolved through four layers onto
	 * the connection row. A kind absent from `AdapterIo.in` has no declared
	 * limits; it is not thereby forbidden.
	 */
	accepts?: readonly KnownMime[]
	/**
	 * Which of `accepts` to convert TOWARD, best first.
	 *
	 * OURS, not the service's — the only field in this file that is an
	 * engineering choice rather than a published fact, and it needs no `source`
	 * for that reason. It is the order handed to `convertMediaTo`, which honours
	 * it strictly.
	 *
	 * It only ever breaks a tie between reachable TARGETS. A file already in
	 * `accepts` passes through untouched whatever this says, because re-encoding
	 * an acceptable JPEG into a "preferred" WebP would spend a generation of
	 * quality to satisfy an ordering that exists only for the conversion case.
	 *
	 * Must be a subset of `accepts` — preferring a format the backend will not
	 * take is a conversion into a guaranteed rejection. Held by `io.test.ts`.
	 */
	prefers?: readonly KnownMime[]
}

/**
 * The limits on what comes BACK, per output kind.
 *
 * Only a count, deliberately. A byte cap on output would be a claim about how
 * big a picture a backend may return, which no service publishes and which
 * nothing here could act on except by throwing away work already paid for.
 */
export interface OutputLimits {
	/** How many files of this kind one request may produce. */
	maxFiles?: Cap
}

/**
 * The whole limits block for one adapter entry.
 *
 * Every field optional, and an entry with no block at all is the common case —
 * see the file header on why that is correct rather than unfinished.
 */
export interface AdapterIo {
	/** Per input kind. */
	in?: Partial<Record<MediaKind, InputLimits>>
	/** Per output kind. */
	out?: Partial<Record<MediaKind, OutputLimits>>
	/**
	 * How many bytes the WHOLE request may carry, across every file in it.
	 *
	 * Separate from `maxBytesPerFile` because they are different limits that bind
	 * at different times: ten 5MB images each pass a 10MB per-file cap and
	 * together blow a 32MB request cap. A single number could not express the
	 * pair, and enforcing only one of them lets exactly one of those two
	 * request shapes through to fail at the service.
	 */
	maxRequestBytes?: Cap
}

// ── Reading it ──────────────────────────────────────────────────────────────

/** The declared limits for one input kind, or undefined for "nothing declared". */
export const inputLimits = (
	io: AdapterIo | undefined,
	kind: MediaKind
): InputLimits | undefined => io?.in?.[kind]

/** The declared limits for one output kind, or undefined. */
export const outputLimits = (
	io: AdapterIo | undefined,
	kind: MediaKind
): OutputLimits | undefined => io?.out?.[kind]

/**
 * The list to hand the conversion router for this kind, preference first — or
 * undefined when nothing is declared, which means "forward it as it is".
 *
 * `prefers` is spliced to the FRONT of `accepts` rather than replacing it: the
 * router treats the list as both the allow-list and the preference order, so
 * offering only the preferred formats would refuse a file in an accepted-but-
 * unpreferred format that the backend would have taken, and offering only
 * `accepts` in declared order would pick whichever the service happened to
 * document first. Both lists normalised on the way out so a comparison against
 * a source mime is like-for-like.
 */
export function offeredMimes(
	io: AdapterIo | undefined,
	kind: MediaKind
): readonly string[] | undefined {
	const limits = inputLimits(io, kind)
	if (!limits?.accepts?.length) return undefined
	const accepts = limits.accepts.map(normalizeMime)
	const prefers = (limits.prefers ?? [])
		.map(normalizeMime)
		.filter((m) => accepts.includes(m))
	return [...new Set([...prefers, ...accepts])]
}

/**
 * Every cap an entry declares, with a path naming where it sits.
 *
 * Exists for the test that walks them: a rule stated as "no cap is zero" is only
 * as good as the enumeration behind it, and a hand-written list of the five
 * places a cap can live would miss the sixth the day one is added.
 */
export function capsOf(
	io: AdapterIo | undefined
): Array<{ path: string; cap: Cap }> {
	const out: Array<{ path: string; cap: Cap }> = []
	if (!io) return out
	const push = (path: string, c: Cap | undefined) => {
		if (c !== undefined) out.push({ path, cap: c })
	}
	push("maxRequestBytes", io.maxRequestBytes)
	for (const kind of MEDIA_KINDS) {
		const i = io.in?.[kind]
		push(`in.${kind}.maxFiles`, i?.maxFiles)
		push(`in.${kind}.maxBytesPerFile`, i?.maxBytesPerFile)
		push(`out.${kind}.maxFiles`, io.out?.[kind]?.maxFiles)
	}
	return out
}

/** Bytes, from a count of binary megabytes — so a declaration reads as the
 *  number its documentation gives rather than as seven digits. */
export const mib = (n: number): number => n * 1024 * 1024
