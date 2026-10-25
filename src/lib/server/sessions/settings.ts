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
 * ## The cascade (§4.13; 🚧 PLAN-layering A3, A10, R32 — 2026-10-20)
 *
 * For every key the genre declares (`shape.fields`) or pins, the lowest
 * layer with a value answers — unless a layer above it **locked** the key,
 * which no layer below may then change (`server/sessions/exposure.ts`, the
 * SDK's `resolveExposure`):
 *
 * ```
 * session   sessions.genre_fields[key]        — stored only when the genre DECLARES the field
 * preset    session_presets.settings[key]     — the session's preset's value (may lock)
 * genre     the genre's defaults' settings    — GenreDecl.defaults.settings over the older
 *           (GenreDecl.settings pins)            GenreDecl.settings pins (may lock)
 * core      the FieldDecl's `default`         — the tooling core ships and its genres use
 * ```
 *
 * Each layer's value is a plain value or `{ value, lock?, askAtStart? }`
 * (`SettingValue`); `askAtStart` places an owner-open setting on the start
 * form and is no level. Who may change a key — the owner when its `reach`
 * is `owner` and nothing above locked it, an administrator otherwise — is
 * the settings form's (`settingsForm.ts`), read through the same resolver.
 * The rules the session plays (its ruleset and rigour) are columns fixed at
 * start (R32): resolved through the same cascade at creation, read-only
 * after, and not part of `fields`.
 *
 * A pinned key with no field renders no control and stores nothing: the pin
 * is what every run reads (the replacement for a `hidden` flag). A stored
 * value under a key the genre does not declare is not a field — declaration
 * is the only way in (§4.11) — so it never reaches the document.
 *
 * A pipeline's settings are not here: they are its registration's values
 * (R38, A9), read by the run through `registrationValueLayers` and shown by
 * the settings form under each registration.
 *
 * ## What the widget envelope gets
 *
 * `widgetSessionProjection` is the envelope's half: `title`, `fields`, the
 * turn-order state, `channels` and `cast` — never `guests`, never
 * `pipelines`, never the `annex` (§4.12; R57: a widget gets the viewer's own
 * view of it, `annex.v1`, from `sessions/annexViews.ts`). The settings form's current values are the other
 * projection of the same document.
 */

import { annexWithoutPoints } from "$lib/server/sessions/annexChanges"
import { annexForPipelines, coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	isSettingDecision,
	readComposerStates,
	readTurnOrder,
	type SessionCastV1,
	type SessionSettingsV1,
	type TurnOrderV1
} from "@serene-pub/sdk"
import {
	cascadeSessionFields,
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
	// 🚧 A9: the session's own values of a pipeline it runs live on its
	// registration rows (the settings form's session layer) — over the
	// ⏳ older per-spec rows above, keyed by the pipeline the row's
	// registration runs.
	// 🚧 R55: each routine in force's mode, by the pipeline it runs. (Story's
	// Rest read the reckoning's here until GM 2026-10-23 — G1 ★3: a press
	// applies at its own action's mode; no core pipeline reads this now.)
	const routineModes: Record<string, "off" | "review" | "full"> = {}
	{
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const resolved = await effectiveRegistrations(db, sessionId)
		for (const r of resolved?.effective ?? [])
			if (r.trigger.family === "routine" && !(r.pipeline in routineModes))
				routineModes[r.pipeline] = r.mode ?? "full"
		const pipelineOf = new Map<string, string>()
		for (const r of [...(resolved?.offered ?? []), ...(resolved?.effective ?? [])]) pipelineOf.set(r.key, r.pipeline)
		for (const row of resolved?.rows.session ?? []) {
			if (row.dropped || !row.values) continue
			const slug = row.specSlug ?? pipelineOf.get(row.key)
			if (!slug) continue
			for (const [nodeKey, slots] of Object.entries(row.values as Record<string, Record<string, unknown>>)) {
				const p = (slots ?? {}).params
				if (p === undefined) continue
				const params = (entry(slug).params[nodeKey] ??= {})
				if (p && typeof p === "object" && !Array.isArray(p))
					for (const [k, v] of Object.entries(p as Record<string, unknown>))
						params[k] = isSettingDecision(v) ? v.value : v
			}
		}
	}

	const metadata = (session.metadata ?? {}) as Record<string, unknown>
	// The state only (R28): what the session chose is in `pipelines[slug]
	// .rebinds`, and what it may choose is on the registry — the document
	// carries no turn-order special case and keys on no spec slug.
	const turnOrder = readTurnOrder(coreAnnexIn(session.annex))
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
		// 🚧 Server-side only, like `guests` (never in `widgetSessionProjection`).
		...(typeof session.userId === "number" ? { ownerUserId: session.userId } : {}),
		genreId,
		presetId: session.presetId ?? null,
		fields: await cascadeSessionFields(db, session, genre),
		...(playerLabel ? { playerLabel } : {}),
		scenario: session.scenario ?? null,
		lorebookId: session.lorebookId ?? null,
		tags: tagRows.map((t) => t.name),
		channels: channelsOf(shape),
		cast,
		pipelines,
		routineModes,
		turnOrder,
		metadata,
		// The annex column (0153, A5) is on the row: not null, default `{}`.
		// The cast and the `?? {}` are left over from before the schema
		// carried it and are inert now; every value is still in here, secrets
		// included, so never hand this to a widget (`annexViewFor`, R57).
		// 🚧 Never the revision points (`annexWithoutPoints`): the legacy
		// copies of the annex, which a script reading this document would
		// carry into its sandbox on every evaluation.
		// 🚧 Never the core runtime keys (`annexForPipelines`): host-held, never a pipeline's to read.
		annex: annexForPipelines(annexWithoutPoints((session as { annex?: unknown }).annex)),
		// 🚧 The composer states (owner ruling 2026-10-15) — only when the
		// genre has closed something, so a document with none is unchanged.
		...(() => {
			const composerStates = readComposerStates(session.composerStates)
			return Object.keys(composerStates).length ? { composerStates } : {}
		})(),
		// 🚧 The session's **lane register** (owner ruling 2026-10-17): on each
		// channel the genre declares `lanes: 'personal'`, whose lane is whose —
		// `{ parley: { "user:3": "parley:2" } }`. Server-side only, like
		// `guests`; only when the genre declares such a channel, so every other
		// document is unchanged. A genre's scripts read it as they read
		// `ownerUserId`; a lane opens through `core:query/channel-lane@1`.
		...(await laneRegisterOf(db, sessionId, shape))
	}
}

/** 🚧 `channelLanes` for the settings document, or nothing (see the call). */
async function laneRegisterOf(
	db: Db,
	sessionId: number,
	shape: unknown
): Promise<{ channelLanes?: Record<string, Record<string, string>> }> {
	const { personalSlugsOf } = await import("$lib/server/channels/lanes")
	const slugs = personalSlugsOf(shape)
	if (!slugs.length) return {}
	const { formatChannel } = await import("@serene-pub/sdk")
	const rows = await db
		.select({
			slug: schema.channelLanes.slug,
			lane: schema.channelLanes.lane,
			userId: schema.channelLanes.userId
		})
		.from(schema.channelLanes)
		.where(eq(schema.channelLanes.sessionId, sessionId))
		.orderBy(asc(schema.channelLanes.lane))
	const channelLanes: Record<string, Record<string, string>> = {}
	for (const slug of slugs) channelLanes[slug] = {}
	for (const r of rows)
		if (channelLanes[r.slug])
			channelLanes[r.slug]![`user:${r.userId}`] = formatChannel({ slug: r.slug, lane: r.lane })
	return { channelLanes }
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
 * 🚧 **Honour mode** (owner rulings 2026-10-15, 2026-10-16): the session's
 * `honorMode` field, a key core reads as it reads `autoAdvance`. `undefined`
 * when the session's genre does not declare it — nothing honour mode gates
 * applies there. The one read of it: the turn delete (`turnDeleteVerdict`)
 * and a player's own sheet (`assertSessionOwner`, `player_seat`) both ask here.
 */
export async function sessionHonourMode(
	db: Db,
	sessionId: number
): Promise<boolean | undefined> {
	const doc = await resolveSessionSettings(db, sessionId)
	const honour = (doc?.fields as Record<string, unknown> | undefined)?.honorMode
	return honour === undefined ? undefined : honour === true
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
