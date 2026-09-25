/**
 * The events admin page's registry layer (PLAN-turn-order §B2): one row per
 * event this instance knows — core's, then every installed package's — with
 * what the declaration says and what the instance does with it.
 *
 * Read, never stored: the declarations come from the SDK registry and the
 * plugin scopes registered from stored manifests (`pluginEvents.ts`), the
 * genres from `listOfferedGenres` (R67), the preset counts from the presets'
 * `bindings` keys. The coverage matrix is not here; it is B4's.
 */

import { eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { allEvents, eventById, i18nText, packageEventById } from "@serene-pub/sdk"
import { packageEventScopes } from "$lib/server/plugins/pluginEvents"
import { listOfferedGenres } from "$lib/server/pipelines/entities/sessionGenres"

export interface EventRegistryRow {
	/** The full event id, `<owner>:event/<name>@<version>`. */
	id: string
	label: string
	description: string
	family: "data" | "action"
	/** Firing it touches a user's account or assets (drives consent). */
	affectsUser: boolean
	/** The payload shape id; a package event's is its author's shape. */
	payload: string | null
	/** Data events: the outlet definitions whose writes cause it. */
	causedBy: string[]
	/** `core`, or the declaring plugin's id. */
	owner: string
	/** The genres whose event surface lists it. */
	genres: Array<{ genreId: string; required: boolean }>
	/** Presets (not withdrawn) that bind it. */
	presets: number
	/** Package events: who may record it, per genre. */
	recordedBy?: Array<{ genreId: string; recordedBy: string[] | "any" }>
}

export interface EventRegistry {
	events: EventRegistryRow[]
	/** The scope pickers' choices: every genre, every preset. */
	genres: Array<{ genreId: string; name: string }>
	presets: Array<{ id: number; name: string; genreId: string }>
}

const humanise = (slug: string): string =>
	slug
		.split("-")
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ")

export async function eventRegistry(db: Db): Promise<EventRegistry> {
	const genres = await listOfferedGenres(db)
	const presetRows = await db
		.select({
			id: schema.sessionPresets.id,
			name: schema.sessionPresets.name,
			genreId: schema.sessionPresets.genreId,
			bindings: schema.sessionPresets.bindings
		})
		.from(schema.sessionPresets)
		.where(isNull(schema.sessionPresets.withdrawnAt))

	const presetCount = new Map<string, number>()
	for (const p of presetRows)
		for (const event of Object.keys(p.bindings ?? {}))
			presetCount.set(event, (presetCount.get(event) ?? 0) + 1)

	const genresOf = (id: string) =>
		genres
			.filter((g) => g.events && id in g.events)
			.map((g) => ({ genreId: g.genreId, required: !!g.events![id]?.required }))

	const core: EventRegistryRow[] = allEvents().map((d) => {
		const id = `core:event/${d.slug}@${d.version}`
		return {
			id,
			label: i18nText(d.name) ?? humanise(d.slug),
			description: i18nText(d.description as never) ?? "",
			family: d.family,
			affectsUser: d.affectsUser,
			payload: d.payload ?? null,
			causedBy: d.causedBy ?? [],
			owner: "core",
			genres: genresOf(id),
			presets: presetCount.get(id) ?? 0
		}
	})

	// A disabled plugin appears nowhere outside the plugins page (owner,
	// 2026-09-24); its declarations stay registered, so turning it back on
	// needs no reinstall.
	const enabledPlugins = new Set(
		(
			await db
				.select({ pluginId: schema.plugins.pluginId })
				.from(schema.plugins)
				.where(eq(schema.plugins.enabled, true))
		).map((r) => r.pluginId)
	)
	const byPackageEvent = new Map<string, EventRegistryRow>()
	for (const s of packageEventScopes()) {
		if (!enabledPlugins.has(s.pluginId)) continue
		let row = byPackageEvent.get(s.event)
		if (!row) {
			const decl = packageEventById(s.event)
			const view = eventById(s.event)
			row = {
				id: s.event,
				label: i18nText(decl?.name ?? s.name) ?? s.event,
				description: i18nText(decl?.description ?? s.description) ?? "",
				family: view?.family ?? "data",
				affectsUser: view?.affectsUser ?? false,
				payload: decl?.payload ?? s.payload,
				causedBy: view?.causedBy ?? [],
				owner: s.pluginId,
				genres: genresOf(s.event),
				presets: presetCount.get(s.event) ?? 0,
				recordedBy: []
			}
			byPackageEvent.set(s.event, row)
		}
		row.recordedBy!.push({ genreId: s.genre, recordedBy: s.recordedBy })
	}

	const events = [
		...core.sort((a, b) => (a.id < b.id ? -1 : 1)),
		...[...byPackageEvent.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
	]
	return {
		events,
		genres: genres.map((g) => ({ genreId: g.genreId, name: g.name })),
		presets: presetRows
			.map((p) => ({ id: p.id, name: p.name, genreId: p.genreId }))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
}
