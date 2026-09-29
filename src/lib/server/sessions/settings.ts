/**
 * The settings document (PLAN-turn-order §4.12, R13) — every setting a person
 * can see in session settings, resolved **once** into one document a run
 * reads, and the cascade that fills its `fields` (§4.13, R14).
 *
 * ## Why one resolver
 *
 * A run's `sessionScope` is a pointer — `{ sessionId, currentCharacterId }` —
 * and until this existed every node that wanted a setting queried a table for
 * it: the cast read here, the genre fields there, a rebind somewhere else.
 * A spec that reads `$.input.session.fields.tone` never learns which table the
 * value came from, and a person who moves a setting between storages moves
 * nothing a spec can see. This is the **only** place the tables are joined;
 * everything else is a projection of what it returns.
 *
 * Three ways in, all served from here:
 *
 *  1. Every core inlet that takes a session publishes it as `session`: the
 *     host resolves it at run start (`runSpec`) and puts it on the input.
 *  2. `core:query/session-settings@1` re-reads it after a write, through the
 *     host's `session_settings` read.
 *  3. Scripts and hooks receive it as the read-only extra `session`.
 *
 * ## The cascade (§4.13)
 *
 * For every key the genre declares (`shape.fields`) or pins
 * (`GenreDecl.settings`), the first layer with a value answers:
 *
 * ```
 * session   sessions.genre_fields[key]   — stored only when the genre DECLARES the field
 * genre     GenreDecl.settings[key]      — a pinned value; never stored per session
 * core      the FieldDecl's `default`    — the tooling core ships and its genres use
 * ```
 *
 * A pinned key with no field renders no control and stores nothing: the pin
 * is what every run reads (the replacement for a `hidden` flag). A stored
 * value under a key the genre does not declare is not a field — declaration
 * is the only way in (§4.11) — so it never reaches the document.
 *
 * ⚠ A key nobody declares or pins resolves to core's default only when core
 * ships a `FieldDecl` for it; that field (`AUTO_ADVANCE_FIELD`, §4.6) is
 * born in A6, and this resolver grows that layer with it. Until then the
 * cascade runs over declared ∪ pinned keys.
 *
 * ## What the widget envelope gets
 *
 * `widgetSessionProjection` is the envelope's half: `title`, `fields`, the
 * turn-order state, `channels` and `cast` — never `guests`, never
 * `pipelines`, never the `annex` (§4.12; R57: a widget gets the viewer's own
 * view of it, `annex.v1`, from `sessions/annexViews.ts`). The settings form's current values are the other
 * projection of the same document.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	readTurnOrder,
	type SessionCastV1,
	type SessionSettingsV1,
	type TurnOrderV1
} from "@serene-pub/sdk"
import {
	cascadeFields,
	getSessionGenre,
	STANDARD_GENRE_ID
} from "$lib/server/pipelines/entities/sessionGenres"
import { channelsOf } from "$lib/server/messages/channels"
import {
	resolvePlayerLabel,
	storedPlayerLabel
} from "$lib/shared/sessions/playerLabel"

/**
 * Resolve the document for a session, or `null` when the session does not
 * exist. Never throws for a missing genre: a session on a genre this build
 * does not declare resolves with no fields and no channels beyond `main`,
 * the same "fall back and say so" posture every other genre read takes.
 */
export async function resolveSessionSettings(
	db: Db,
	sessionId: number
): Promise<SessionSettingsV1 | null> {
	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null

	const genreId = session.genreId ?? STANDARD_GENRE_ID
	const genre = await getSessionGenre(db, genreId)
	const shape = genre?.shape

	const [guests, tagRows, rebindRows, overrideRows, cast] = await Promise.all([
		db
			.select({ userId: schema.sessionGuests.userId })
			.from(schema.sessionGuests)
			.where(eq(schema.sessionGuests.sessionId, sessionId))
			.orderBy(asc(schema.sessionGuests.userId)),
		db
			.select({ name: schema.tags.name })
			.from(schema.sessionTags)
			.innerJoin(schema.tags, eq(schema.sessionTags.tagId, schema.tags.id))
			.where(eq(schema.sessionTags.sessionId, sessionId))
			.orderBy(asc(schema.tags.id)),
		db
			.select({
				slug: schema.pipelineSpecs.slug,
				nodeKey: schema.pipelineNodeRebinds.nodeKey,
				definitionId: schema.pipelineNodeRebinds.definitionId
			})
			.from(schema.pipelineNodeRebinds)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineNodeRebinds.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineNodeRebinds.scopeKind, "session"),
					eq(schema.pipelineNodeRebinds.scopeId, sessionId)
				)
			)
			.orderBy(asc(schema.pipelineNodeRebinds.id)),
		db
			.select({
				slug: schema.pipelineSpecs.slug,
				nodeKey: schema.pipelineNodeOverrides.nodeKey,
				path: schema.pipelineNodeOverrides.path,
				value: schema.pipelineNodeOverrides.value
			})
			.from(schema.pipelineNodeOverrides)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineNodeOverrides.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, sessionId),
					eq(schema.pipelineNodeOverrides.slot, "params")
				)
			)
			.orderBy(asc(schema.pipelineNodeOverrides.id)),
		readCast(db, sessionId)
	])

	/**
	 * Per bound spec slug: the session-scope rows in force (§4.12). A spec
	 * with no session-scope row has nothing in force, so it has no entry —
	 * the same fact as `{ rebinds: {}, params: {} }`, without listing every
	 * spec the genre binds on every run.
	 */
	const pipelines: SessionSettingsV1["pipelines"] = {}
	const entry = (slug: string) =>
		(pipelines[slug] ??= { rebinds: {}, params: {} })
	for (const r of rebindRows) entry(r.slug).rebinds[r.nodeKey] = r.definitionId
	for (const r of overrideRows) {
		const params = (entry(r.slug).params[r.nodeKey] ??= {})
		if (r.path === "") {
			// A whole-slot value: its keys are the params.
			if (r.value && typeof r.value === "object" && !Array.isArray(r.value))
				Object.assign(params, r.value as Record<string, unknown>)
		} else params[r.path] = r.value
	}

	const metadata = (session.metadata ?? {}) as Record<string, unknown>
	// The state only (R28): what the session chose is in `pipelines[slug]
	// .rebinds`, and what it may choose is on the registry — the document
	// carries no turn-order special case and keys on no spec slug.
	const turnOrder = readTurnOrder(metadata)
	// What the person's own lines are called (R4): the session's override
	// (`metadata.playerLabel`), else the genre's, else absent — the one
	// cascade the page and the prompt also resolve through.
	const playerLabel = resolvePlayerLabel({
		declared: genre?.playerLabel,
		stored: storedPlayerLabel(metadata)
	})

	return {
		v: 1,
		sessionId,
		title: session.name ?? null,
		guests: guests.map((g) => g.userId),
		genreId,
		presetId: session.presetId ?? null,
		fields: cascadeFields({
			declared: (shape?.fields ?? {}) as Record<string, { default?: unknown }>,
			pinned: genre?.settings ?? {},
			stored: (session.genreFields ?? {}) as Record<string, unknown>
		}),
		...(playerLabel ? { playerLabel } : {}),
		scenario: session.scenario ?? null,
		lorebookId: session.lorebookId ?? null,
		tags: tagRows.map((t) => t.name),
		channels: channelsOf(shape),
		cast,
		pipelines,
		turnOrder,
		metadata,
		// The annex column (0153, A5) is on the row: not null, default `{}`.
		// The cast and the `?? {}` are left over from before the schema
		// carried it and are inert now; every value is still in here, secrets
		// included, so never hand this to a widget (`annexViewFor`, R57).
		annex:
			((session as { annex?: unknown }).annex as
				| Record<string, unknown>
				| undefined) ?? {}
	}
}

/**
 * What `core:query/session-cast@1` publishes (§4.12): the host's one cast
 * read — characters, personas, the seated envoys — minus the lorebook roster
 * that read carries for retrieval's gazetteer (the same drop the node's
 * binding makes: the roster is the book's, not the session's). No turn is
 * asked about here, so `currentCharacterId` is null: nothing in the
 * document has been pooled or picked.
 */
async function readCast(db: Db, sessionId: number): Promise<SessionCastV1> {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db, { sessionId })
	const raw = (await host.read!(
		"session_cast",
		{ sessionId },
		{
			key: "session",
			definitionId: "core:query/session-settings",
			definitionVersion: 1,
			kind: "query"
		}
	)) as (Record<string, unknown> & { lorebookBindings?: unknown }) | null
	const { lorebookBindings: _roster, ...cast } = raw ?? {}
	return {
		sessionCharacters: [],
		sessionPersonas: [],
		envoys: [],
		sessionScenario: null,
		isGroup: false,
		...cast,
		currentCharacterId: null
	} as SessionCastV1
}

/**
 * The widget envelope's `session` (§4.8, §4.12): what a widget may see of
 * the document. `guests` and `pipelines` never cross — they are the
 * owner's, not the audience's. Typed structurally here so the envelope's
 * `SessionV1` (sdk `widgets.ts`) can adopt it field for field when the
 * client cutover (A8) lands, with nothing to reshape.
 */
export function widgetSessionProjection(doc: SessionSettingsV1): {
	id: number
	name: string | null
	fields: Record<string, unknown>
	turnOrder: TurnOrderV1
	channels: string[]
	cast: SessionCastV1
} {
	// Never `doc.annex`: that is every value, secrets included. A widget
	// gets the viewer's own view (`annexViewFor`, R57).
	return {
		id: doc.sessionId,
		name: doc.title,
		fields: doc.fields,
		turnOrder: doc.turnOrder,
		channels: doc.channels,
		cast: doc.cast
	}
}
