/**
 * 🚧 **The genre's defaults** (R22; PLAN-layering D4, D7) — where a genre's
 * default registrations come from, before `project.ts` writes them as rows.
 *
 * Two sources, in this order:
 *
 *  1. **Declared** — `GenreDecl.defaults.registrations`: core's five genres
 *     (`coreGenres()` registers them carrying their defaults), and a package
 *     genre built against an SDK that has them.
 *  2. ⏳ **Derived from the old inlet locks** (D7 plugin back-compat, to
 *     0.7): a package genre that declares none gets exactly what a session
 *     of it resolved before registrations existed — on each event the first
 *     published spec (by spec id) whose lock answers (genre, event), core's
 *     default save on `message-offered` where nothing answers it, and every
 *     action its own namespace contributes to the genre (the companion
 *     rule). A foreign package's locked action is offered, never defaulted.
 *
 * Pure apart from the core import: the rows it derives from are handed in,
 * so the data upgrade (raw SQL at its anchor) and the boot projection read
 * one rule.
 */
import {
	actionsOf,
	genreDefaultsOf,
	getGenre,
	SAVE_MESSAGE_SPEC_ID,
	sessionEvents,
	type RegistrationDecl
} from "@serene-pub/sdk"
import { actionRegistration, eventRegistration } from "$lib/server/pipelines/registrations/rows"

let coreReady: Promise<void> | null = null

/**
 * Register core's genres carrying their defaults (lane 3: a host calls
 * `coreGenres()` before reading a genre's defaults). Once per process.
 */
export function ensureCoreGenres(): Promise<void> {
	coreReady ??= import("@serene-pub/core-catalog").then((m) => {
		m.coreGenres()
	})
	return coreReady
}

/** The genre's declared default registrations, or null when it declares none. */
export async function declaredGenreDefaults(genreId: string): Promise<readonly RegistrationDecl[] | null> {
	await ensureCoreGenres()
	const regs = genreDefaultsOf(getGenre(genreId))?.registrations
	return regs && regs.length ? regs : null
}

/** One published spec's lock and contributions, as the legacy derivation reads them. */
export interface LockedSpecRow {
	slug: string
	inputGenre: string | null
	inputEvent: string | null
	inputEvents: string[] | null
	contributes: unknown
	/**
	 * 🚧 The events an unlocked spec **suits** (D3; lane 5b) — the new form's
	 * hints. A package genre that declares no defaults gets them derived from
	 * its own namespace's suits as from its locks.
	 */
	suits?: string[] | null
}

/**
 * Whether a genre's own namespace's `suits` speak for it: a package's. Core's
 * genres declare their defaults, and a `core:` genre that declares none is a
 * lock-era one (a fixture, a fork) — core's own unlocked specs suit every
 * genre and name none, so they never derive one.
 */
const suitsCount = (genreId: string): boolean => namespaceOf(genreId) !== "core"

/** The events a spec answers for a genre: its lock's, or — unlocked, in the genre's namespace — what it suits. */
function eventsFor(s: LockedSpecRow, genreId: string, withSuits: boolean): string[] {
	if (s.inputGenre === genreId)
		return [s.inputEvent, ...(Array.isArray(s.inputEvents) ? s.inputEvents : [])].filter(
			(e): e is string => typeof e === "string" && !!e
		)
	if (withSuits && suitsCount(genreId) && !s.inputGenre && Array.isArray(s.suits) && namespaceOf(s.slug) === namespaceOf(genreId))
		return s.suits.filter((e) => typeof e === "string" && !!e)
	return []
}

const namespaceOf = (id: string): string => {
	const i = id.indexOf(":")
	return i === -1 ? "" : id.slice(0, i)
}

const answers = (row: LockedSpecRow, event: string): boolean =>
	row.inputEvent === event || (Array.isArray(row.inputEvents) && row.inputEvents.includes(event))

/**
 * ⏳ A genre's defaults derived from its specs' old inlet locks — today's
 * resolution made explicit (D7). `specs` are the published, active specs,
 * ordered by spec id (the old tie-break: "first-published").
 */
export function legacyGenreDefaults(genreId: string, specs: readonly LockedSpecRow[]): RegistrationDecl[] {
	const out: RegistrationDecl[] = []
	const events = new Set<string>()
	for (const s of specs) for (const e of eventsFor(s, genreId, true)) events.add(e)
	for (const event of events) {
		// A lock answers before a suit: the old resolution first, then what
		// the package's unlocked specs say they suit (🚧 D7, lane 5b).
		const first =
			specs.find((s) => s.inputGenre === genreId && answers(s, event)) ??
			specs.find((s) => eventsFor(s, genreId, true).includes(event))
		if (first) out.push(eventRegistration(event, first.slug))
	}
	// 🚧 A person's message is always saved through a pipeline (owner ruling
	// 2026-10-15): core's default save where the genre's own specs bind none.
	if (!events.has(sessionEvents.messageOffered))
		out.push(eventRegistration(sessionEvents.messageOffered, SAVE_MESSAGE_SPEC_ID))
	// The companion rule, explicit: every action the genre owner's namespace
	// contributes to it — and, from an unlocked spec there, every action it
	// contributes at all (a `suits` spec's actions name no genre).
	out.push(...companionActions(genreId, specs, true))
	return out
}

/**
 * ⏳ The companion rule over old locks: every action a spec in the genre
 * owner's namespace contributes to the genre through its inlet lock. A
 * declared genre's defaults name its own (lane 3's specs carry no lock); this
 * keeps a lock-era spec published since — a test fixture, a draft — offered
 * where the companion rule offered it.
 */
export function companionActions(
	genreId: string,
	specs: readonly LockedSpecRow[],
	withSuits = false
): RegistrationDecl[] {
	const out: RegistrationDecl[] = []
	const ns = namespaceOf(genreId)
	const seen = new Set<string>()
	for (const s of specs) {
		if (namespaceOf(s.slug) !== ns) continue
		for (const a of actionsOf({ id: s.slug, contributes: s.contributes })) {
			const genre = (a as { genre?: string }).genre
			if (
				genre !== genreId &&
				!(withSuits && suitsCount(genreId) && genre === undefined && !s.inputGenre && Array.isArray(s.suits))
			)
				continue
			const identity = `${s.slug}#${a.key}`
			if (seen.has(identity)) continue
			seen.add(identity)
			out.push(actionRegistration(identity))
		}
	}
	return out
}

/**
 * The genre's defaults, declared or ⏳ derived — what `project.ts` writes at
 * genre scope. `origin` says which: `genre` for a declaration, the package's
 * own origin for a derivation.
 */
export async function genreDefaultsFor(
	genreId: string,
	lockedSpecs: readonly LockedSpecRow[]
): Promise<{ registrations: readonly RegistrationDecl[]; derived: boolean }> {
	const declared = await declaredGenreDefaults(genreId)
	if (declared) {
		// ⏳ Plus a lock-era companion action the declaration does not name.
		const keys = new Set(declared.map((d) => d.key))
		const extra = companionActions(genreId, lockedSpecs).filter((d) => !keys.has(d.key))
		return { registrations: extra.length ? [...declared, ...extra] : declared, derived: false }
	}
	return { registrations: legacyGenreDefaults(genreId, lockedSpecs), derived: true }
}
