/**
 * The `session_layout_presets` table's server module (PLAN 25 redesign,
 * 2026-08-30): the boot seed reconciler, plus the reads the socket handlers
 * resolve a session's active layout through.
 *
 * Seeds one shipped **default** preset per genre and prunes the defaults of
 * genres it is syncing whose seed key is no longer shipped — the same "seed the
 * defaults, remove defaults no longer in the list" pass `widgetStyles.ts` runs
 * for widget skins, which this deliberately mirrors statement for statement.
 * Runs on boot, right after the pipeline specs the genre list is read from.
 *
 * ## The upgrade-safety landmine (why this looks the way it does)
 *
 * The codified seed rule (see defaults.ts) is: match on a natural key, NEVER on
 * a numeric id, and never let a seed touch a user row. Both invariants are
 * enforced structurally rather than by care:
 *
 *   • Upsert and prune both match on `seed_key` (`layout:<genreId>:default`),
 *     and every write additionally requires `author_user_id IS NULL`. A
 *     user-authored preset carries `seed_key = NULL` and an author, so it fails
 *     BOTH predicates — it is invisible to every statement below, and cannot be
 *     overwritten or pruned by a reseed even if it somehow shared a key.
 *   • Rows are inserted with NO explicit id — the identity sequence assigns one —
 *     so there is no id collision with user rows and no `resyncIdSequences` need.
 *
 * ## Why the shipped default is an EMPTY layout — and the one exception
 *
 * `{}` means "no overrides", which is precisely what the client renders when a
 * user has saved nothing: the app's own built-in arrangement. That makes the
 * default preset a real, selectable row that means "the shipped layout" —
 * applying it clears your overrides — while keeping the preset system inert for
 * everyone who never touches it. See `$lib/shared/sessionLayout/presets` for
 * how the layers compose.
 *
 * A genre may nevertheless ship an arrangement (`SeedableGenre.layout`), and
 * the Adventure genre does: a world strip above the conversation, the party
 * docked down the right. That is a genre saying what its surface IS, which is
 * a different statement from a user saving one, and it still composes the same
 * way — under the user's own `layoutSettings` and under their own arrangement,
 * so anybody who has moved a panel keeps what they moved.
 *
 * ## Prune scope
 *
 * Confined to the genre ids actually being synced, exactly as widgetStyles
 * confines itself to the widget ids it processed. A genre that has gone away
 * (a plugin disabled between boots) is NOT in scope, so its default survives
 * rather than being deleted out from under the `layout_preset_id` references
 * pointing at it — those would be silently nulled by the FK's `ON DELETE SET
 * NULL`, quietly resetting people's choices. An orphaned default is harmless:
 * nothing lists it, because nothing lists that genre.
 */
import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	or,
	type SQL
} from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import {
	DEFAULT_PRESET_NAME,
	layoutPresetSeedKey,
	presetWidgetSettings
} from "$lib/shared/sessionLayout/presets"
import {
	BUILT_IN_LAYOUT_DOC,
	builtInLayoutDoc
} from "$lib/shared/sessionLayout/document"
import {
	canManage,
	canSee,
	canShare,
	type LayoutActor,
	type LayoutPresetOrigin
} from "./layoutPermissions"
import { readWidgetSettings } from "./widgetSettings"
import { validateLayoutDoc } from "@serene-pub/sdk"
import type { LayoutDecls, LayoutDoc, LayoutPreset } from "@serene-pub/sdk"
import type {
	LayoutPresetRow,
	LayoutTier,
	LayoutVisibility,
	ResolvedLayout
} from "$lib/shared/sockets/layouts"

/** The genres to seed a default preset for. */
export interface SeedableGenre {
	genreId: string
	/**
	 * The preset's name. Absent means `Default`.
	 *
	 * A genre that ships an arrangement of its own gets to name it — "Adventure"
	 * rather than "Default" — because the presets list shows it beside a user's
	 * own saved layouts, and "Default" there reads as "no layout" when it is in
	 * fact the genre's whole intended surface.
	 */
	name?: string
	/**
	 * ⏳ The LEGACY arrangement, verbatim. Absent means `{}` — "no overrides",
	 * i.e. the app's own built-in layout, which is what keeps the preset system
	 * inert for every genre that does not ship one (see the header).
	 */
	layout?: Record<string, unknown>
	/**
	 * The v2 **layout preset** this genre ships: the document plus the
	 * per-instance settings and style pins that came with it.
	 *
	 * Absent means "look it up": the reconciler asks `coreLayoutV2(genreId)`,
	 * so the boot task does not have to union a second catalog list the way it
	 * unions the legacy one. Passed explicitly by tests and by any caller that
	 * wants to say something the catalog does not.
	 */
	preset?: LayoutPreset
}

/** What a reseed stamps on the rows it wrote, and which app version wrote them. */
export interface SyncLayoutPresetsOptions {
	/** Provenance for `seeded_by_version`, as `syncWidgetStyles` takes it. */
	version?: string
}

/**
 * Reconcile the shipped per-genre default presets against
 * `session_layout_presets`. Idempotent: safe to run every boot.
 *
 * ## Two documents per row, until P6
 *
 * Every seeded row gets BOTH the legacy `layout` blob (from the genre's
 * `SeedableGenre.layout`, i.e. `CORE_LAYOUT_PRESETS`) and the v2 `document`
 * (from `CORE_LAYOUTS_V2`, else the built-in floor). The legacy renderer is
 * still the one most people are looking at, and a row that stopped carrying
 * its blob would blank their session the moment they upgraded; a row that
 * carried no document would make the v2 stage fall through to the floor for a
 * genre that ships a whole surface. So both, written from one pass, until the
 * legacy half is deleted.
 */
export async function syncLayoutPresets(
	genres: SeedableGenre[],
	options: SyncLayoutPresetsOptions = {}
): Promise<void> {
	// De-duplicate: the genre list unions create-spec genres with transitional
	// input-type genres, and `seed_key` is globally unique — a repeated genre id
	// would make the second insert collide.
	const genreIds = [...new Set(genres.map((g) => g.genreId).filter(Boolean))]
	const shippedKeys = genreIds.map(layoutPresetSeedKey)
	// Last wins, so a caller that unions a genre list with a shipped one may
	// pass the bare id first and the furnished entry after it. Deduplicating on
	// the id above and looking the content up here keeps those two facts apart:
	// which genres exist, and what each one ships.
	const byGenre = new Map(
		genres.filter((g) => g.genreId).map((g) => [g.genreId, g])
	)

	// Every row already holding a seed key — authored ones INCLUDED, because
	// `seed_key` is globally unique. Nothing in the app ever gives a user row a
	// seed key (the save path writes NULL), but if one somehow held a shipped
	// key, filtering it out here would send us down the insert branch and the
	// unique constraint would abort the boot seed. Reading it and skipping is
	// both crash-proof and the stronger reading of "never touch a user row".
	const existing = await db
		.select({
			id: schema.sessionLayoutPresets.id,
			seedKey: schema.sessionLayoutPresets.seedKey,
			origin: schema.sessionLayoutPresets.origin,
			authorUserId: schema.sessionLayoutPresets.authorUserId
		})
		.from(schema.sessionLayoutPresets)
		.where(isNotNull(schema.sessionLayoutPresets.seedKey))
	const existingByKey = new Map(existing.map((r) => [r.seedKey as string, r]))

	const writes: Promise<unknown>[] = []
	for (const genreId of genreIds) {
		const seedKey = layoutPresetSeedKey(genreId)
		const found = existingByKey.get(seedKey)
		// A row someone authored is not ours to re-force, whatever key it holds.
		if (found && found.authorUserId !== null) continue
		// …nor is a plugin's. A plugin's seed keys are namespaced
		// (`layout:<genreId>:<pluginId>/<slug>`) so one cannot collide with a
		// genre default's key, but the scope is stated rather than inferred.
		if (found && found.origin === "plugin") continue
		const shipped = byGenre.get(genreId)
		// A genre that ships no document of its own still gets one: the
		// built-in floor, stored rather than implied, so the `genre` tier of
		// the chain answers for every genre and the floor is only reached by a
		// session whose genre has no row at all.
		const v2 = shipped?.preset ??
			(await coreLayoutPreset(genreId)) ?? { layout: builtInLayoutDoc() }
		const name = shipped?.name ?? (await coreLayoutName(genreId)) ?? DEFAULT_PRESET_NAME
		const layout = shipped?.layout ?? {}
		// A shipped document that does not validate is REPORTED and left out
		// rather than written: the chain falls through a null document to the
		// built-in floor, which is a session that draws. Writing a refused
		// document would put the failure in every reader instead of in the log.
		const document = v2 ? await checkedShippedDoc(v2.layout, seedKey) : null
		const shippedFields = {
			genreId,
			origin: "core" as const,
			pluginId: null,
			withdrawnAt: null,
			slug: DEFAULT_LAYOUT_SLUG,
			name,
			visibility: "shared" as const,
			layout,
			document,
			widgetSettings: v2?.widgetSettings ?? null,
			widgetStyles: v2?.widgetStyles ?? null,
			seededByVersion: options.version ?? null
		}
		if (!found) {
			writes.push(
				db.insert(schema.sessionLayoutPresets).values({
					// NO id — the sequence assigns one (seed rule).
					seedKey,
					authorUserId: null,
					...shippedFields
				})
			)
		} else {
			// Re-force the shipped fields; never the id, never the author.
			writes.push(
				db
					.update(schema.sessionLayoutPresets)
					.set(shippedFields)
					.where(
						and(
							eq(schema.sessionLayoutPresets.seedKey, seedKey),
							isNull(schema.sessionLayoutPresets.authorUserId)
						)
					)
			)
		}
	}
	await Promise.all(writes)

	// Prune: seeded defaults for the genres we just synced whose key is gone
	// (a row left by an older key scheme). Scoped to author-less, seed-keyed,
	// `origin = 'core'` rows AND to the genre ids actually processed, so a
	// plugin's rows, another genre's default and every user row are untouched.
	// The early return only saves a round trip: `inArray` over an empty list
	// already matches nothing, so an empty genre set could not delete anything
	// even without it.
	if (genreIds.length) {
		await db
			.delete(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.origin, "core"),
					isNull(schema.sessionLayoutPresets.authorUserId),
					isNotNull(schema.sessionLayoutPresets.seedKey),
					inArray(schema.sessionLayoutPresets.genreId, genreIds),
					notInArray(schema.sessionLayoutPresets.seedKey, shippedKeys)
				)
			)
	}
}

/** The slug the genre's own layout holds — reserved to the genre's owner. */
export const DEFAULT_LAYOUT_SLUG = "default"

/**
 * The declaration sets `validateLayoutDoc` reads, loaded once.
 *
 * Deferred rather than imported at the top for the reason every other
 * core-catalog read in this layer is deferred: this module is pulled in by the
 * boot path, and the catalog registers types as a side effect of being
 * imported. Both sets only affect WARNINGS (an unknown widget id, an
 * undeclared look key), so a build that somehow cannot load them still refuses
 * exactly the documents it should.
 */
let declsPromise: Promise<LayoutDecls> | null = null
async function layoutDecls(): Promise<LayoutDecls> {
	declsPromise ??= import("@serene-pub/core-catalog").then((m) => ({
		widgets: m.CORE_WIDGETS,
		looks: m.CORE_LOOKS
	}))
	return declsPromise
}

/** The v2 preset a core genre ships, if it ships one. */
async function coreLayoutPreset(genreId: string): Promise<LayoutPreset | null> {
	const { coreLayoutV2 } = await import("@serene-pub/core-catalog")
	return coreLayoutV2(genreId)?.preset ?? null
}

/** …and the name it ships it under. */
async function coreLayoutName(genreId: string): Promise<string | null> {
	const { coreLayoutV2 } = await import("@serene-pub/core-catalog")
	return coreLayoutV2(genreId)?.name ?? null
}

/**
 * A shipped document, or null with one log line. Never throws: a boot that
 * refuses a genre is a boot that offers nothing.
 */
async function checkedShippedDoc(
	doc: LayoutDoc,
	seedKey: string
): Promise<LayoutDoc | null> {
	const verdict = validateLayoutDoc(doc, await layoutDecls())
	if (!verdict.ok) {
		console.warn(
			`[layouts] shipped layout ${seedKey} was refused and not stored: ` +
				verdict.errors.join(" ")
		)
		return null
	}
	if (verdict.warnings.length)
		console.warn(
			`[layouts] shipped layout ${seedKey}: ${verdict.warnings.join(" ")}`
		)
	return doc
}

/* ── reads ──────────────────────────────────────────────────────────────
 * Visibility is the ruled matrix (§4.5), and it lives in ONE predicate:
 * `visibleTo`. A caller sees every shipped row that has not been withdrawn,
 * every shared row, and their own — never anybody else's private one, admin
 * included. Enforced in the query rather than by the caller remembering to
 * filter, because this is the only place that reads the table.
 */

/** ⏳ The legacy wire row, which `LayoutPresetRow` is a superset of. */
type LegacyLayoutPreset = Sockets.Sessions.LayoutPreset

type PresetRow = typeof schema.sessionLayoutPresets.$inferSelect

/**
 * Row → wire. `seedKey` is deliberately not published: it is the reconciler's
 * private matching key, and a client that could read it would be one edit away
 * from being able to send one.
 *
 * Spelled out field by field, so a column added later never joins the wire
 * silently.
 */
function toWire(row: PresetRow): LayoutPresetRow {
	return {
		id: row.id,
		name: row.name,
		genreId: row.genreId,
		// ⏳ LEGACY: what the pre-v2 client reads as "not yours to manage".
		isDefault: row.authorUserId === null,
		layout: row.layout && typeof row.layout === "object" ? row.layout : {},
		origin: (row.origin as LayoutPresetOrigin) ?? "user",
		visibility: (row.visibility as LayoutVisibility) ?? "private",
		slug: row.slug ?? "",
		description: row.description ?? null,
		document: (row.document as LayoutDoc | null) ?? null,
		pluginId: row.pluginId ?? null,
		authorUserId: row.authorUserId ?? null,
		updatedAt: row.updatedAt.toISOString()
	}
}

/**
 * `WHERE genre = … AND not withdrawn AND (shipped OR shared OR mine)` — the
 * one visibility predicate, and the SQL half of `canSee`.
 *
 * The first branch asks `origin`, not `author_user_id`, on purpose: `origin` is
 * a column no user-facing verb writes, so a row cannot be made to masquerade as
 * a shipped one.
 */
function visibleTo(genreId: string, userId: number): SQL | undefined {
	return and(
		eq(schema.sessionLayoutPresets.genreId, genreId),
		isNull(schema.sessionLayoutPresets.withdrawnAt),
		or(
			ne(schema.sessionLayoutPresets.origin, "user"),
			eq(schema.sessionLayoutPresets.visibility, "shared"),
			eq(schema.sessionLayoutPresets.authorUserId, userId)
		)
	)
}

/** The rank a row lists at: core, then plugins, then people's own. */
const ORIGIN_ORDER: Record<string, number> = { core: 0, plugin: 1, user: 2 }

/**
 * The presets a user may choose from for a genre: the shipped ones first, then
 * their own and the instance's shared ones, oldest first (creation order — a
 * stable list that doesn't reshuffle when someone renames one).
 */
export async function listLayoutPresets(
	genreId: string,
	userId: number
): Promise<LayoutPresetRow[]> {
	const rows = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(visibleTo(genreId, userId))
	return rows
		.slice()
		.sort((a, b) => {
			const ao = ORIGIN_ORDER[a.origin] ?? 2
			const bo = ORIGIN_ORDER[b.origin] ?? 2
			return ao !== bo ? ao - bo : a.id - b.id
		})
		.map(toWire)
}

/**
 * Is this preset one the caller may apply to this session? The guard behind
 * `layoutPresetId` on the write path: a preset must belong to the session's
 * genre AND be one the caller can see. Without it, any id at all could be
 * pinned into another user's row, which would then resolve and render a
 * stranger's layout.
 */
export async function canApplyLayoutPreset(
	presetId: number,
	genreId: string,
	userId: number
): Promise<boolean> {
	if (!Number.isInteger(presetId)) return false
	const [row] = await db
		.select({ id: schema.sessionLayoutPresets.id })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, presetId),
				visibleTo(genreId, userId)
			)
		)
		.limit(1)
	return !!row
}

/**
 * ⏳ LEGACY. The `layout` BLOB of the preset a session is actually on, already
 * through its whole fallback chain: the pinned preset if it still resolves for
 * this caller, else the genre's shipped default, else `{}`.
 *
 * `{}` is not a failure mode — it is what the shipped default itself carries,
 * and it composes to "no base at all" (see `presetBase`), which is exactly what
 * every session rendered before presets existed. The v2 chain is
 * `resolveLayoutFor`, which never reads this column.
 */
export async function resolveActivePresetLayout(
	genreId: string,
	userId: number,
	layoutPresetId: number | null
): Promise<Record<string, unknown>> {
	if (layoutPresetId != null) {
		const [pinned] = await db
			.select({ layout: schema.sessionLayoutPresets.layout })
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.id, layoutPresetId),
					visibleTo(genreId, userId)
				)
			)
			.limit(1)
		if (pinned?.layout && typeof pinned.layout === "object")
			return pinned.layout as Record<string, unknown>
	}
	const [fallback] = await db
		.select({ layout: schema.sessionLayoutPresets.layout })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(
					schema.sessionLayoutPresets.seedKey,
					layoutPresetSeedKey(genreId)
				),
				isNull(schema.sessionLayoutPresets.authorUserId)
			)
		)
		.limit(1)
	return fallback?.layout && typeof fallback.layout === "object"
		? (fallback.layout as Record<string, unknown>)
		: {}
}

/** The longest a user-supplied preset name may be. */
export const LAYOUT_PRESET_NAME_MAX = 80

/** The longest a description may be. One line about a layout, not an essay. */
export const LAYOUT_PRESET_DESCRIPTION_MAX = 400

/** What a document that does not validate is refused with, its errors appended. */
export const LAYOUT_DOC_REFUSED = "That layout can't be stored"

/**
 * Validate a document on its way to storage, or refuse it with a sentence.
 *
 * Every write path in this module goes through here — §4.6's "the server runs
 * `validateLayoutDoc` on every write and refuses with a sentence". Warnings are
 * not refusals: an unknown widget id draws a labelled placeholder, which is
 * what keeps uninstalling a plugin from stranding somebody's layout.
 */
export async function checkLayoutDoc(
	doc: unknown
): Promise<{ ok: true; document: LayoutDoc } | Refused> {
	const verdict = validateLayoutDoc(doc, await layoutDecls())
	if (!verdict.ok)
		return {
			ok: false,
			error: `${LAYOUT_DOC_REFUSED} — ${verdict.errors.join(" ")}`
		}
	return { ok: true, document: doc as LayoutDoc }
}

/** The name, trimmed and bounded; the description likewise, or null. */
const cleanName = (name: unknown): string =>
	typeof name === "string" ? name.trim().slice(0, LAYOUT_PRESET_NAME_MAX) : ""
const cleanDescription = (d: unknown): string | null => {
	const t = typeof d === "string" ? d.trim().slice(0, LAYOUT_PRESET_DESCRIPTION_MAX) : ""
	return t || null
}

/**
 * A name as a **slug**: the stable key the row is addressed by within its
 * owner. Kebab, lower case, ASCII — the grammar shipped slugs already use
 * (`default`, `cinematic`), so a person's row and a genre's read the same way.
 */
export function layoutSlugFrom(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
	return base || "layout"
}

/**
 * …and the first form of it this author has not already used in this genre.
 *
 * The partial unique index `(author_user_id, genre_id, slug)` is the real
 * guarantee; this is what keeps it from being hit in the ordinary case of
 * somebody saving "Wide" twice. A race that beats it still raises the
 * constraint, which the caller retries — see `insertUserPreset`.
 */
async function freeUserSlug(
	genreId: string,
	userId: number,
	name: string
): Promise<string> {
	const base = layoutSlugFrom(name)
	const taken = new Set(
		(
			await db
				.select({ slug: schema.sessionLayoutPresets.slug })
				.from(schema.sessionLayoutPresets)
				.where(
					and(
						eq(schema.sessionLayoutPresets.genreId, genreId),
						eq(schema.sessionLayoutPresets.origin, "user"),
						eq(schema.sessionLayoutPresets.authorUserId, userId)
					)
				)
		).map((r) => r.slug)
	)
	if (!taken.has(base)) return base
	for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
	return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/** The fields a user row carries whatever verb wrote it. */
interface UserPresetContent {
	name: string
	description: string | null
	document: LayoutDoc | null
	widgetSettings: Record<string, Record<string, unknown>> | null
	widgetStyles: Record<string, { id: number; slug: string }> | null
	/** ⏳ The legacy blob. `{}` reads as "no overrides" to the pre-v2 client. */
	layout: Record<string, unknown>
}

/**
 * Insert one user row, retrying its slug once if a concurrent save took it.
 *
 * `seedKey` is unconditionally NULL, `origin` unconditionally `user` and
 * `authorUserId` unconditionally the caller: the three facts that keep
 * everything saved here outside both reconcilers' reach forever.
 */
async function insertUserPreset(
	genreId: string,
	userId: number,
	content: UserPresetContent,
	visibility: LayoutVisibility = "private"
): Promise<PresetRow> {
	const values = {
		seedKey: null,
		genreId,
		origin: "user" as const,
		pluginId: null,
		withdrawnAt: null,
		authorUserId: userId,
		visibility,
		seededByVersion: null,
		...content
	}
	const slug = await freeUserSlug(genreId, userId, content.name)
	try {
		const [row] = await db
			.insert(schema.sessionLayoutPresets)
			.values({ ...values, slug })
			.returning()
		return row
	} catch {
		// The unique index is the authority, not the read above it. One retry
		// with a slug nothing can have raced us to. Anything that was NOT a
		// slug collision fails the same way twice, and the second throw is the
		// one the caller sees — untouched, so a real fault still reads as one.
		const [row] = await db
			.insert(schema.sessionLayoutPresets)
			.values({
				...values,
				slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`
			})
			.returning()
		return row
	}
}

/**
 * Save the caller's layout as a new user-authored preset.
 *
 * Takes the v2 `preset` (document + per-instance settings + style pins), the
 * ⏳ legacy `layout` blob, or both — because the pre-v2 client still calls this
 * with a blob and the v2 editor calls it with a document, and one row has to
 * serve both readers until P6. A v2 save writes `layout: {}`, which the legacy
 * client reads as "no overrides" rather than as a crash.
 */
export async function saveUserLayoutPreset(args: {
	genreId: string
	userId: number
	name: string
	description?: string
	preset?: LayoutPreset
	/** ⏳ LEGACY. */
	layout?: Record<string, unknown>
}): Promise<LayoutPresetRow> {
	const checked = args.preset
		? await checkLayoutDoc(args.preset.layout)
		: null
	// The legacy caller has no document to refuse; a v2 one that fails throws,
	// because its handler has already run the same check and reported it.
	if (checked && !checked.ok) throw new Error(checked.error)
	const row = await insertUserPreset(args.genreId, args.userId, {
		name: cleanName(args.name),
		description: cleanDescription(args.description),
		document: checked?.ok ? checked.document : null,
		widgetSettings: args.preset?.widgetSettings ?? null,
		widgetStyles: args.preset?.widgetStyles ?? null,
		layout: args.layout ?? {}
	})
	return toWire(row)
}
/* ── managing what you saved ────────────────────────────────────────────
 * Managing a preset is a NARROWER permission than seeing one, and the matrix
 * is `layoutPermissions.ts` — this half only turns its answers into the
 * sentences a person reads. Core's and a plugin's rows are the reconcilers'
 * and nobody else's, however senior the asker; a shared row is its author's
 * and an admin's; a private one is its author's alone.
 */

/** What a foreign, missing, or unusable id is refused with. One sentence for all. */
export const LAYOUT_PRESET_UNKNOWN = "Unknown layout preset"
/** …and what a shipped default is refused with, per verb. */
export const LAYOUT_PRESET_BUILT_IN_RENAME =
	"Built-in layouts can't be renamed — save a copy instead."
export const LAYOUT_PRESET_BUILT_IN_DELETE =
	"Built-in layouts can't be deleted."
export const LAYOUT_PRESET_BUILT_IN_SHARE =
	"Built-in layouts are already shared with everyone."
/** Shared with the save path's own check; a rename may not blank a name. */
export const LAYOUT_PRESET_NEEDS_NAME = "A preset needs a name"
/** A guest may keep and edit their own layouts; publishing one is not theirs. */
export const LAYOUT_PRESET_GUEST_NO_SHARE =
	"You can use and save your own layouts, but not share one with the instance."

/** A refused manage attempt — the sentence is the whole result. */
type Refused = { ok: false; error: string }

/**
 * The one ownership gate behind rename, re-capture, share, delete and usage.
 *
 * The order of the checks is a PRIVACY order, not a logical one: a row that
 * belongs to somebody else, or that a withdrawn plugin left behind, is refused
 * with the EXACT sentence a row that does not exist gets, so the id space
 * cannot be walked to learn what other people have saved. Only rows the caller
 * can already see — the shipped ones, which everybody sees, and the shared ones
 * — earn a distinct, more helpful refusal.
 */
async function manageablePreset(
	presetId: number,
	actor: LayoutActor,
	builtInError: string,
	verb: "change" | "delete" = "change"
): Promise<{ ok: true; row: PresetRow } | Refused> {
	// The id arrives off the wire: a non-integer would reach the driver as a
	// malformed comparison rather than a miss.
	if (!Number.isInteger(presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [row] = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, presetId))
		.limit(1)
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	// Withdrawn is "not there", not "not yours": the plugin is gone for now.
	if (row.withdrawnAt) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	// Shipped is visible to all, editable by none. Also catches the row that
	// should not exist — authored AND seed-keyed — because letting its author
	// rename or delete it would hand a user the reconciler's private key.
	if (row.origin !== "user" || row.seedKey !== null)
		return { ok: false, error: builtInError }
	if (canManage(row, actor)) return { ok: true, row }
	// Not theirs. A private row is answered as absent; a shared one is a real
	// object they can see, so it gets the real reason.
	if (!canSee(row, actor)) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return {
		ok: false,
		error: `Only the owner or an admin can ${verb} a shared layout.`
	}
}

/**
 * Rename one of the caller's own presets. The name is trimmed and capped the
 * same way `saveUserLayoutPreset` caps it, so the two paths cannot disagree
 * about what a stored name may be.
 */
export async function renameUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	name: string
}): Promise<{ ok: true; preset: LayoutPresetRow } | Refused> {
	const name = cleanName(args.name)
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_RENAME
	)
	if (!found.ok) return found
	// The predicate is restated on the write rather than trusted from the read:
	// the gate above cannot hold a row still, and a rename that lands on a row
	// the gate did not approve is the one failure worth making impossible.
	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ name })
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/**
 * The predicate every approved write restates: this id, still a user row, still
 * its author's, still without a seed key. The gate read the row; this makes the
 * write land on the same row the gate approved and on no other.
 */
function manageWrite(presetId: number, row: PresetRow): SQL | undefined {
	return and(
		eq(schema.sessionLayoutPresets.id, presetId),
		eq(schema.sessionLayoutPresets.origin, "user"),
		eq(
			schema.sessionLayoutPresets.authorUserId,
			row.authorUserId as number
		),
		isNull(schema.sessionLayoutPresets.seedKey)
	)
}

/** How many `session_panel_layouts` rows are pinned to a preset. */
async function pinnedSessionCount(presetId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.sessionPanelLayouts)
		.where(eq(schema.sessionPanelLayouts.layoutPresetId, presetId))
	return Number(row?.n ?? 0)
}

/**
 * Delete one of the caller's own presets, reporting how many sessions were on
 * it.
 *
 * Nothing is stranded and nothing cascades away: `layout_preset_id` is
 * `ON DELETE SET NULL` on both `session_panel_layouts` and
 * `user_layout_defaults`, so a session that was pinned to this preset — and a
 * person who defaulted to it — quietly falls back through the chain with their
 * own layout blob and widget settings untouched. That is the intended
 * behaviour, which is exactly why the count is taken FIRST: after the delete
 * the FK has already erased the evidence, and a client that wants to warn
 * before the fact has nothing to warn with.
 */
export async function deleteUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<
	| { ok: true; id: number; genreId: string; affectedSessions: number }
	| Refused
> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_DELETE,
		"delete"
	)
	if (!found.ok) return found
	const affectedSessions = await pinnedSessionCount(args.presetId)
	// Restated for the same reason as the rename's — see above.
	const deleted = await db
		.delete(schema.sessionLayoutPresets)
		.where(manageWrite(args.presetId, found.row))
		.returning({ id: schema.sessionLayoutPresets.id })
	if (!deleted.length) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return {
		ok: true,
		id: args.presetId,
		genreId: found.row.genreId,
		affectedSessions
	}
}

/**
 * How many sessions are on one of the caller's own presets — what the delete
 * confirmation warns with. Behind the same gate as the delete it precedes, so
 * the count can never answer for a preset the asker could not delete anyway.
 */
export async function layoutPresetUsage(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<{ ok: true; id: number; sessions: number } | Refused> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_DELETE,
		"delete"
	)
	if (!found.ok) return found
	return {
		ok: true,
		id: args.presetId,
		sessions: await pinnedSessionCount(args.presetId)
	}
}

/**
 * Rename, re-describe or RE-CAPTURE one of the caller's own presets.
 *
 * A re-capture replaces the document, the pinned settings and the style pins
 * together — they are one statement about how the surface looks, and updating
 * the document alone would leave the old pins addressing instance keys that are
 * no longer in it. Omitting `preset` leaves all three exactly as they were.
 */
export async function updateUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	name?: string
	description?: string
	preset?: LayoutPreset
}): Promise<{ ok: true; preset: LayoutPresetRow } | Refused> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_RENAME
	)
	if (!found.ok) return found

	const patch: Partial<UserPresetContent> = {}
	if (args.name !== undefined) {
		const name = cleanName(args.name)
		if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
		patch.name = name
	}
	if (args.description !== undefined)
		patch.description = cleanDescription(args.description)
	if (args.preset !== undefined) {
		const checked = await checkLayoutDoc(args.preset.layout)
		if (!checked.ok) return checked
		patch.document = checked.document
		patch.widgetSettings = args.preset.widgetSettings ?? null
		patch.widgetStyles = args.preset.widgetStyles ?? null
	}
	if (!Object.keys(patch).length)
		return { ok: true, preset: toWire(found.row) }

	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set(patch)
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/**
 * Publish one of the caller's own presets to the instance, or take it back.
 *
 * Taking a shared row private does not un-apply it: a session already pinned to
 * it keeps its `layout_preset_id`, and resolution then falls through for
 * everyone but the author — which is the same degradation a deleted preset
 * gives, and the reason nothing here touches other people's rows.
 */
export async function shareLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	isGuest?: boolean
	visibility: LayoutVisibility
}): Promise<{ ok: true; preset: LayoutPresetRow } | Refused> {
	if (args.visibility !== "shared" && args.visibility !== "private")
		return { ok: false, error: "A layout can only be private or shared." }
	const actor: LayoutActor = {
		id: args.userId,
		isAdmin: args.isAdmin,
		isGuest: args.isGuest
	}
	const found = await manageablePreset(
		args.presetId,
		actor,
		LAYOUT_PRESET_BUILT_IN_SHARE
	)
	if (!found.ok) return found
	if (!canShare(found.row, actor))
		return { ok: false, error: LAYOUT_PRESET_GUEST_NO_SHARE }

	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ visibility: args.visibility })
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/**
 * Copy any preset the caller can SEE into a new private row of their own.
 *
 * Seeing it is the whole permission, because the copy SNAPSHOTS the document,
 * the settings and the pins and keeps no reference back: the original moving
 * does not move the copy, and nothing is taken from its owner. This is how a
 * built-in becomes editable.
 */
export async function cloneLayoutPreset(args: {
	presetId: number
	userId: number
	name?: string
}): Promise<{ ok: true; preset: LayoutPresetRow } | Refused> {
	if (!Number.isInteger(args.presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [source] = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, args.presetId))
		.limit(1)
	const actor: LayoutActor = { id: args.userId }
	if (!source || !canSee(source, actor))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }

	const name = cleanName(args.name ?? `${source.name} (copy)`)
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const row = await insertUserPreset(source.genreId, args.userId, {
		name,
		description: source.description ?? null,
		document: (source.document as LayoutDoc | null) ?? null,
		widgetSettings: source.widgetSettings ?? null,
		widgetStyles: source.widgetStyles ?? null,
		// ⏳ The legacy blob comes along, so the pre-v2 client can apply the
		// copy and see what the original showed it.
		layout: source.layout ?? {}
	})
	return { ok: true, preset: toWire(row) }
}

/**
 * One preset as a portable `LayoutPreset` — what `import` reads back and what a
 * plugin would ship. Anything the caller can see, which includes the built-ins:
 * exporting is reading, and a clone can already take a copy of one.
 */
export async function exportLayoutPreset(args: {
	presetId: number
	userId: number
}): Promise<
	| {
			ok: true
			presetId: number
			genreId: string
			name: string
			description: string | null
			preset: LayoutPreset
	  }
	| Refused
> {
	if (!Number.isInteger(args.presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [row] = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, args.presetId))
		.limit(1)
	if (!row || !canSee(row, { id: args.userId }))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const document = (row.document as LayoutDoc | null) ?? null
	if (!document)
		return {
			ok: false,
			error: "That layout has nothing to export yet — open and save it once."
		}
	const preset: LayoutPreset = { layout: document }
	if (row.widgetSettings) preset.widgetSettings = row.widgetSettings
	if (row.widgetStyles) preset.widgetStyles = row.widgetStyles
	return {
		ok: true,
		presetId: row.id,
		genreId: row.genreId,
		name: row.name,
		description: row.description ?? null,
		preset
	}
}

/**
 * Read a `LayoutPreset` back in as a new private row of the caller's.
 *
 * Validated like every other write: a file somebody edited by hand is exactly
 * the untrusted document `validateLayoutDoc` exists for.
 */
export async function importLayoutPreset(args: {
	genreId: string
	userId: number
	name?: string
	description?: string
	preset: LayoutPreset
}): Promise<{ ok: true; preset: LayoutPresetRow } | Refused> {
	const bundle = args.preset
	if (!bundle || typeof bundle !== "object" || !("layout" in bundle))
		return {
			ok: false,
			error: `${LAYOUT_DOC_REFUSED} — it carries no layout document.`
		}
	const checked = await checkLayoutDoc(bundle.layout)
	if (!checked.ok) return checked
	const name = cleanName(args.name ?? "Imported layout")
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const row = await insertUserPreset(args.genreId, args.userId, {
		name,
		description: cleanDescription(args.description),
		document: checked.document,
		widgetSettings: bundle.widgetSettings ?? null,
		widgetStyles: bundle.widgetStyles ?? null,
		// An imported layout is a v2 document; the legacy client reads `{}` as
		// "no overrides" and renders its own built-in arrangement.
		layout: {}
	})
	return { ok: true, preset: toWire(row) }
}

/* ── the resolution chain (§4.4) ────────────────────────────────────────── */

/** The row a tier answered with, and which tier that was. */
interface Answer {
	row: PresetRow | null
	tier: LayoutTier
}

/** One preset by id, if this caller may see it AND it carries a document. */
async function documentedPreset(
	presetId: number | null | undefined,
	userId: number
): Promise<PresetRow | null> {
	if (presetId == null || !Number.isInteger(presetId)) return null
	const [row] = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, presetId))
		.limit(1)
	if (!row || !canSee(row, { id: userId })) return null
	return row.document ? row : null
}

/**
 * The document this person sees in this session, and everything that came with
 * it (§4.4).
 *
 * ```
 * document = active.document
 *         ?? preset(active.layout_preset_id).document
 *         ?? preset(user_layout_defaults[user, genre]).document
 *         ?? preset(seed_key = layout:<genre>:default).document
 *         ?? BUILT_IN
 * ```
 *
 * Whole documents at each step, never per slot: a layout is one statement about
 * a surface, and merging two of them would produce a third that nobody wrote.
 *
 * ⚠ The ⏳ legacy `layout` blobs are NOT consulted here. A session whose only
 * arrangement is a pre-v2 blob resolves to the tier below it — the client reads
 * its own blob through `fromLegacy` until P6 — so this never invents a
 * document from one.
 */
export async function resolveLayoutFor(
	sessionId: number,
	userId: number
): Promise<ResolvedLayout> {
	const [active] = await db
		.select()
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
		.limit(1)

	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const genreId = session?.genreId ?? null

	const answer = await (async (): Promise<Answer> => {
		// 1. The person's own document for this session.
		if (active?.document)
			return { row: null, tier: "session" }
		// 2. The preset they applied.
		const pinned = await documentedPreset(active?.layoutPresetId, userId)
		if (pinned) return { row: pinned, tier: "preset" }
		if (!genreId) return { row: null, tier: "built-in" }
		// 3. Their default for this genre.
		const [def] = await db
			.select({ layoutPresetId: schema.userLayoutDefaults.layoutPresetId })
			.from(schema.userLayoutDefaults)
			.where(
				and(
					eq(schema.userLayoutDefaults.userId, userId),
					eq(schema.userLayoutDefaults.genreId, genreId)
				)
			)
			.limit(1)
		const preferred = await documentedPreset(def?.layoutPresetId, userId)
		if (preferred) return { row: preferred, tier: "user-default" }
		// 4. The genre's own.
		const [shipped] = await db
			.select()
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(
						schema.sessionLayoutPresets.seedKey,
						layoutPresetSeedKey(genreId)
					),
					isNull(schema.sessionLayoutPresets.withdrawnAt)
				)
			)
			.limit(1)
		if (shipped?.document) return { row: shipped, tier: "genre" }
		// 5. The floor.
		return { row: null, tier: "built-in" }
	})()

	const document =
		answer.tier === "session"
			? ((active!.document as LayoutDoc) ?? builtInLayoutDoc())
			: ((answer.row?.document as LayoutDoc | undefined) ??
				builtInLayoutDoc())

	// The person's own values sit OVER the chosen preset's pins, per widget and
	// per field — `presetWidgetSettings` is the one merge rule, reused rather
	// than restated, and it reads the pins out of a `widgetSettings` key.
	const own = await readWidgetSettings(sessionId, userId)
	const settings = presetWidgetSettings(
		{ widgetSettings: answer.row?.widgetSettings ?? {} },
		own
	)

	const activePins =
		active?.layoutSettings &&
		typeof active.layoutSettings === "object" &&
		typeof (active.layoutSettings as Record<string, unknown>)
			.widgetStyles === "object"
			? ((active.layoutSettings as Record<string, unknown>)
					.widgetStyles as Record<string, { id: number; slug: string }>)
			: {}
	const stylePins = { ...(answer.row?.widgetStyles ?? {}), ...activePins }

	return {
		sessionId,
		document,
		// A session on a preset reports it even when its own document answered:
		// that is the row "Reset" puts it back to.
		presetId: answer.row?.id ?? active?.layoutPresetId ?? null,
		origin: (answer.row?.origin as LayoutPresetOrigin | undefined) ?? null,
		tier: answer.tier,
		settings,
		stylePins
	}
}
