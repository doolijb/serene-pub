/**
 * The **attic wiring** — the end of the 0.5.3 upgrade, run by the `pipelines`
 * startup task once `bootstrapPipelines` has seeded the specs, presets and
 * templates the wiring writes against (plan §4.1 part C).
 *
 * By the time this runs, `migrateLegacyToPipelines` has brought every 0.5.3
 * config's prompt text across from the attic, idempotent by its marker. What
 * is left here:
 *
 *   · a chat's reply strategy, when it was not the default, becomes a rebind
 *     of its session's turn-order strategy node (D8): `manual` →
 *     `core:task/turn-manual@1`, `userSplit` → `core:task/turn-user-split@1`;
 *     `ordered` and none are the spec's own round robin and write nothing;
 *   · a chat that ignored retrieval (`metadata.ragIgnored`, which switched
 *     0.5.3's RAG off for that chat) gets search-by-meaning **off** as a session
 *     override on every pipeline that has the switch; the flag stays, since
 *     the session page's notice still reads it;
 *   · a chat's own prompt config ("AI Override"), which 0.5.3 stored and never
 *     read, is said in a note — it is a configuration of its own already, and
 *     selecting it would change what that chat sends (owner ruling M5);
 *   · the proof that the wiring finished: every prompt-bearing config a person
 *     wrote in 0.5.3 has its migrated row, or a note saying why it has none
 *     (context configs are not carried — `etl/configs.ts` notes them);
 *   · dropping the attic, which is what marks the upgrade done.
 *
 * Anything thrown here leaves the attic in place, and the next start runs the
 * wiring again; every step of it is idempotent.
 */
import { eq, inArray, isNotNull, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { atticExists, atticRestoredAt, dropAttic } from "./index"
import * as attic from "./tables"
import { UpgradeNotes, countUpgradeNotes, writeUpgradeNotes } from "./notes"

/** 0.5.3's group reply strategies that are not round robin. */
export const STRATEGY_REBINDS: Record<string, string> = {
	manual: "core:task/turn-manual@1",
	userSplit: "core:task/turn-user-split@1"
}

/** The 0.5.3 config tables `migrateLegacy` brings across, by name. */
const TABLES = {
	prompt_configs: attic.promptConfigs,
	narrator_prompt_configs: attic.narratorPromptConfigs,
	world_summarize_configs: attic.worldSummarizeConfigs,
	character_summarize_configs: attic.characterSummarizeConfigs,
	scene_summarize_configs: attic.sceneSummarizeConfigs,
	graph_build_configs: attic.graphBuildConfigs
} as const

export interface AtticWiringReport {
	rebinds: number
	/** Sessions whose search by meaning was switched off (`ragIgnored`). */
	searchOff: number
	notes: number
}

export async function finishAtticUpgrade(
	db: Db
): Promise<AtticWiringReport | null> {
	if (!(await atticExists(db))) return null
	if (!(await atticRestoredAt(db)))
		throw new Error(
			"0.5.3 upgrade: the attic has not been restored yet, so its configurations cannot be wired; the `attic` startup task runs first."
		)

	const notes = new UpgradeNotes()
	const rebinds = await rebindStrategies(db, notes)
	const searchOff = await switchOffIgnoredRetrieval(db, notes)
	await noteChatPromptOverrides(db, notes)
	await assertWiring(db, notes)
	const written = await writeUpgradeNotes(db, notes.list)
	// The summary and the notification come last, so they count every note
	// the upgrade wrote — the restore's and these — this one included.
	const total = (await countUpgradeNotes(db)) + 1
	await writeUpgradeNotes(db, [
		{
			topic: "summary",
			objectLabel: "0.5.3 → 0.6",
			summary: `Your 0.5.3 data was upgraded to 0.6 with ${total} note(s), this one included; the pre-upgrade backup is in the data folder's backups.`
		}
	])
	await dropAttic(db)
	await announce(db, total)
	return { rebinds, searchOff, notes: written + 1 }
}

/** One notification to every admin, after the commit. */
async function announce(db: Db, notes: number): Promise<void> {
	try {
		const { eq } = await import("drizzle-orm")
		const admins = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.isAdmin, true))
		const { raiseNotification } = await import("$lib/server/notifications/store")
		const { DATA_UPGRADE_DONE, regardingFor } = await import(
			"$lib/shared/notifications/kinds"
		)
		await raiseNotification(
			{
				userIds: admins.map((a) => a.id),
				kind: DATA_UPGRADE_DONE.id,
				regarding: regardingFor.dataUpgrade(),
				href: "/admin/history?type=data-upgrade",
				vars: { notes }
			},
			db
		)
	} catch (err) {
		console.warn("[attic] the upgrade finished but its notification could not be raised:", err)
	}
}


async function rebindStrategies(db: Db, notes: UpgradeNotes): Promise<number> {
	const chats = await db
		.select({
			id: attic.chats.id,
			name: attic.chats.name,
			userId: attic.chats.userId,
			strategy: attic.chats.groupReplyStrategy
		})
		.from(attic.chats)
		.where(inArray(attic.chats.groupReplyStrategy, Object.keys(STRATEGY_REBINDS)))
	if (!chats.length) return 0

	const [{ setSessionNodeRebind }, { TURN_ORDER_BY_GENRE }] = await Promise.all([
		import("$lib/server/pipelines/entities/bindings"),
		import("@serene-pub/core-catalog")
	])
	let written = 0
	for (const c of chats) {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId, userId: schema.sessions.userId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, c.id))
			.limit(1)
		if (!session) continue
		const turnOrder = TURN_ORDER_BY_GENRE.find((t) => t.genre.id === session.genreId)
		const definitionId = STRATEGY_REBINDS[c.strategy!]
		const result = turnOrder
			? await setSessionNodeRebind(db, {
					sessionId: c.id,
					userId: session.userId,
					spec: turnOrder.spec,
					nodeKey: turnOrder.strategyNode,
					definitionId
				})
			: { error: "its genre has no turn order to set" }
		if (result.error)
			notes.add({
				topic: "wiring",
				objectLabel: c.name ?? `chat ${c.id}`,
				summary: `The chat "${c.name ?? c.id}" took turns "${c.strategy}" in 0.5.3, but its session could not be set to the same (${result.error}); it takes turns in order until changed in its settings.`
			})
		else written++
	}
	return written
}

/** The value of `searchByMeaning` that never searches. */
export const SEARCH_BY_MEANING_OFF = "off"

async function switchOffIgnoredRetrieval(
	db: Db,
	notes: UpgradeNotes
): Promise<number> {
	const chats = (
		await db
			.select({
				id: attic.chats.id,
				name: attic.chats.name,
				metadata: attic.chats.metadata
			})
			.from(attic.chats)
	).filter((c) => (c.metadata as { ragIgnored?: unknown } | null)?.ragIgnored === true)
	if (!chats.length) return 0

	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const specs = await db.select().from(schema.pipelineSpecs)
	const switches: Array<{ specId: number; nodeKey: string; path: string }> = []
	for (const spec of specs) {
		if (spec.activeVersionId == null) continue
		for (const d of await declarations(db, spec.activeVersionId))
			if (d.slot === "params" && d.path === "searchByMeaning")
				switches.push({ specId: spec.id, nodeKey: d.nodeKey, path: d.path })
	}

	let sessions = 0
	for (const c of chats) {
		const [session] = await db
			.select({ id: schema.sessions.id, userId: schema.sessions.userId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, c.id))
			.limit(1)
		if (!session) continue
		for (const s of switches)
			await db
				.insert(schema.pipelineNodeOverrides)
				.values({
					specId: s.specId,
					scopeKind: "session",
					scopeId: session.id,
					nodeKey: s.nodeKey,
					slot: "params",
					path: s.path,
					value: SEARCH_BY_MEANING_OFF,
					updatedBy: session.userId,
					updatedAt: new Date()
				})
				.onConflictDoNothing()
		sessions++
		notes.add({
			topic: "search-by-meaning",
			objectLabel: c.name ?? `chat ${c.id}`,
			summary: `The chat "${c.name ?? c.id}" ignored retrieval in 0.5.3, so its session has search by meaning switched off; turn it back on in the session's pipeline settings.`
		})
	}
	return sessions
}

async function noteChatPromptOverrides(db: Db, notes: UpgradeNotes): Promise<void> {
	const chats = await db
		.select({
			id: attic.chats.id,
			name: attic.chats.name,
			promptConfigId: attic.chats.promptConfigId
		})
		.from(attic.chats)
		.where(isNotNull(attic.chats.promptConfigId))
	if (!chats.length) return
	const configs = new Map(
		(
			await db
				.select({
					id: attic.promptConfigs.id,
					name: attic.promptConfigs.name,
					seedKey: attic.promptConfigs.seedKey
				})
				.from(attic.promptConfigs)
		).map((c) => [c.id, c])
	)
	for (const c of chats) {
		const label = c.name ?? `chat ${c.id}`
		const config = configs.get(c.promptConfigId!)
		const name = config?.name ?? `prompt config ${c.promptConfigId}`
		const where = config?.seedKey
			? `"${name}" is one of the prompts 0.6 ships`
			: `"${name}" is kept as a configuration`
		notes.add({
			topic: "prompt-override",
			objectLabel: label,
			summary: `The chat "${label}" named "${name}" as its own prompt config ("AI Override"), which 0.5.3 stored but never used — its replies were written with its owner's active prompt config, and still are. ${where}; the session is not switched to it.`
		})
	}
}

/**
 * Every prompt-bearing config a person wrote in 0.5.3 arrived: a prompt,
 * narrator, summarize or graph-build config has a `migrated:<spec>:<id>`
 * configuration for each pipeline it feeds. A pipeline this build does not
 * publish is the one reason a config may have none, and that is said in a
 * note. Anything else refuses, so the attic stays and the wiring runs again.
 */
async function assertWiring(db: Db, notes: UpgradeNotes): Promise<void> {
	const { SOURCES_BY_TABLE } = await import(
		"$lib/server/pipelines/migrate/migrateLegacy"
	)
	const missing: string[] = []
	for (const [table, specs] of Object.entries(SOURCES_BY_TABLE)) {
		const source = TABLES[table as keyof typeof TABLES]
		if (!source) continue
		const rows = await db
			.select({ id: source.id, name: source.name })
			.from(source)
			.where(isNull(source.seedKey))
		for (const specSlug of specs) {
			const [spec] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, specSlug))
				.limit(1)
			if (!spec?.activeVersionId) {
				for (const r of rows)
					notes.add({
						topic: "wiring",
						objectLabel: r.name,
						summary: `"${r.name}" (${table}) was not brought into the ${specSlug} pipeline: this build does not publish it. The text is in the pre-upgrade backup.`
					})
				continue
			}
			for (const r of rows) {
				const [config] = await db
					.select({ id: schema.pipelineConfigs.id })
					.from(schema.pipelineConfigs)
					.where(eq(schema.pipelineConfigs.seedKey, `migrated:${specSlug}:${r.id}`))
					.limit(1)
				if (!config) missing.push(`${table} ${r.id} → ${specSlug}`)
			}
		}
	}

	if (missing.length)
		throw new Error(
			`0.5.3 upgrade: these configurations were not brought across, so the upgrade will be finished at the next start:\n · ${missing.join("\n · ")}`
		)
}
