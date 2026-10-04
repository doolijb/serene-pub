/**
 * Test-only: put a 0.5.3 fixture where the app looks for its data, and boot
 * the app's own database module over it.
 *
 * The fixture (`db/fixtures/0.5.3/`, MANIFEST.json beside it) is a real 0.5.3
 * data directory: the PGlite folder as a tarball, the users' files, and the
 * `meta.json` whose secret its API keys are encrypted under. They land in the
 * per-file throwaway data dir `vitest.setup.ts` hands every test file — never
 * in `/tmp` directly — in the layout 0.5.3 itself writes
 * (`<SERENE_PUB_DATA_DIR>/data/{serene-pub.db,users,meta.json}`).
 *
 * Import nothing that opens the database before `placeFixture` has run.
 *
 * `bootFixture` then imports `$lib/server/db`, which does exactly what a boot
 * does: the pre-migration backup, the migrations with their data upgrades
 * (the attic stash), and `defaults.sync()`. `runUpgradeTasks` runs the startup
 * tasks the upgrade spans, in the order `startup/index.ts` lists them. One
 * fixture per test file: the database module is a per-file singleton.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const FIXTURES = path.resolve(
	process.cwd(),
	"src/lib/server/db/fixtures/0.5.3"
)

export type FixtureName = "big" | "tiny"

export interface FixtureManifest {
	counts: Record<string, number>
	credentials: Record<string, [string, string]> | null
	ids: Record<string, any>
	detail: Record<string, any>
	edgeCases: Array<{ id: string; table: string; note: string; rowIds?: number[] }>
	files: { entries: string[] }
}

const dirOf = (name: FixtureName) =>
	name === "big" ? FIXTURES : path.join(FIXTURES, "tiny")

export function fixtureManifest(name: FixtureName): FixtureManifest {
	return JSON.parse(
		fs.readFileSync(path.join(dirOf(name), "MANIFEST.json"), "utf8")
	)
}

/** The data root vitest made for this file, with the fixture laid out in it. */
export function placeFixture(
	name: FixtureName,
	opts: { meta?: "meta.json" | "meta.dev.json" } = {}
): { appDataDir: string; dataDir: string; secret: string } {
	const appDataDir = process.env.SERENE_PUB_DATA_DIR
	if (!appDataDir) throw new Error("vitest.setup.ts did not set SERENE_PUB_DATA_DIR")
	const dataDir = path.join(appDataDir, "data")
	const dbDir = path.join(dataDir, "serene-pub.db")
	fs.mkdirSync(dbDir, { recursive: true })
	const src = dirOf(name)
	execFileSync("tar", ["xzf", path.join(src, "serene-pub.db.tgz"), "-C", dbDir])
	execFileSync("tar", ["xzf", path.join(src, "users.tgz"), "-C", dataDir])
	const meta = fs.readFileSync(path.join(src, opts.meta ?? "meta.json"), "utf8")
	fs.writeFileSync(path.join(dataDir, "meta.json"), meta)
	return { appDataDir, dataDir, secret: JSON.parse(meta).cryptoSecretKey }
}

/** Boot the app's database module over the placed fixture. */
export async function bootFixture(): Promise<Db> {
	const mod = await import("$lib/server/db")
	await mod.dbReady
	return mod.db as unknown as Db
}

/** The startup tasks the upgrade spans, in `startupTasks` order. */
export async function runUpgradeTasks(db: Db) {
	const { restoreFromAttic } = await import("./restore")
	const restore = await restoreFromAttic(db)
	const { migrateMessages } = await import("$lib/server/messages/store")
	const messages = await migrateMessages(db)
	const { reconcileDerelictReplies } = await import(
		"$lib/server/sessions/derelictReplies"
	)
	const replies = await reconcileDerelictReplies({ db, enqueue: async () => {} })
	const { migrateEmbeddingConnection } = await import(
		"$lib/server/embedding/migrateEmbeddingConnection"
	)
	const embedding = await migrateEmbeddingConnection(db)
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	const pipelines = await bootstrapPipelines(db)
	const { finishAtticUpgrade } = await import("./finish")
	const wiring = await finishAtticUpgrade(db)
	return { restore, messages, replies, embedding, pipelines, wiring }
}

export interface PreviewOutcome {
	outcome: string
	halt: string | null
	reason: string | null
	/** The rendered prompt, as one JSON string: what the model would be sent. */
	text: string
}

/**
 * A session's next reply as a preview — every step up to the model call, and
 * nothing sent: the run a person's first press would make. The speaker is
 * the session's first seated character.
 */
export async function previewTurn(db: Db, sessionId: number): Promise<PreviewOutcome> {
	const client = (db as any).$client
	const [session] = (
		await client.query(`SELECT user_id FROM sessions WHERE id = $1`, [sessionId])
	).rows
	const [seat] = (
		await client.query(
			`SELECT character_id FROM session_characters WHERE session_id = $1 AND character_id IS NOT NULL AND removed_at IS NULL ORDER BY position, character_id LIMIT 1`,
			[sessionId]
		)
	).rows
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	const receipt: any = await runTurn({
		db,
		sessionId,
		userId: session.user_id,
		currentCharacterId: seat?.character_id ?? null,
		text: "",
		preview: true,
		skipReceipt: true
	} as any)
	return {
		outcome: receipt.outcome,
		halt: receipt.haltNodeKey ?? null,
		reason: receipt.haltReason ?? null,
		text: JSON.stringify(receipt.preview?.context?.rendered ?? null)
	}
}

/**
 * What the pipeline layer holds for configurations, as comparable rows: the
 * configs, their values, every selection and every session override. Ids
 * are kept — a second boot that renumbered a row changed it.
 */
export async function configurationState(db: Db) {
	const client = (db as any).$client
	const rows = async (text: string) => (await client.query(text)).rows
	return {
		configs: await rows(
			`SELECT id, spec_id, name, seed_key, is_immutable FROM pipeline_configs ORDER BY id`
		),
		values: await rows(
			`SELECT config_id, node_key, slot, path, value::text AS value FROM pipeline_config_values ORDER BY config_id, node_key, slot, path`
		),
		selections: await rows(
			`SELECT spec_id, scope_kind, scope_id, config_id FROM pipeline_config_selections ORDER BY spec_id, scope_kind, scope_id`
		),
		overrides: await rows(
			`SELECT spec_id, scope_kind, scope_id, node_key, slot, path, value::text AS value FROM pipeline_node_overrides ORDER BY spec_id, scope_kind, scope_id, node_key, slot, path`
		),
		connections: await rows(
			`SELECT id, name, type, base_url, preset, extra_json::text AS extra, capabilities::text AS caps FROM connections ORDER BY id`
		),
		connectionDefaults: await rows(`SELECT * FROM connection_defaults ORDER BY 1`),
		sampling: await rows(
			`SELECT id, name, seed_key, values::text AS v, enabled::text AS e FROM sampling_configs ORDER BY id`
		),
		bindings: await rows(`SELECT id, name, binding FROM lorebook_bindings ORDER BY id`),
		relationships: await rows(
			`SELECT id, history_entry_id FROM narrative_relationships ORDER BY id`
		)
	}
}
