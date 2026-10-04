/**
 * The 0.5.3 → 0.6 upgrade does what 0.5.3 did — over the big fixture, judged
 * by what a session would SEND rather than by which rows exist.
 *
 * A row-count test passes over an upgrade whose sessions cannot compile a
 * prompt, and over one that compiles the wrong prompt: both happened. So the
 * first boot is previewed, session by session, before anything else touches
 * the database; then a second boot (the defaults sync and every startup task
 * again) must leave the configurations exactly as the first left them.
 *
 * The 0.5.3 rules being held to (owner rulings 2026-10-01, round 2 and the
 * prompt-text-only ruling after it):
 *   · a config's prompt TEXT is carried and nothing else — not its params,
 *     not its own connection or sampling picks, and no context config at all;
 *     each is an accepted loss in a note;
 *   · a person's `active_*_config_id` prompt picks were the only lever 0.5.3
 *     read (`getUserConfigurations`: user → system), so they select at
 *     session scope on every session that person owns;
 *   · a chat's own "AI Override" prompt config was never read — kept as a
 *     configuration, never selected, and said in a note;
 *   · a chat's narrator config WAS read (`resolveNarratorPromptConfig`), so it
 *     still selects for its session;
 *   · `ragIgnored` switched retrieval off for its chat.
 */
import { beforeAll, describe, expect, test } from "vitest"
import {
	bootFixture,
	configurationState,
	fixtureManifest,
	placeFixture,
	previewTurn,
	runUpgradeTasks,
	type PreviewOutcome
} from "./testFixture"
import { ATTIC_SCHEMA, atticExists } from "./index"

const manifest = fixtureManifest("big")
const ids = manifest.ids
let db: Db

type Row = any
const q = async (text: string, ...params: unknown[]): Promise<Row[]> =>
	((await (db as any).$client.query(text, params)) as { rows: Row[] }).rows
const one = async (text: string, ...params: unknown[]): Promise<Row> =>
	(await q(text, ...params))[0]

const before: Record<string, Row[]> = {}
const ATTIC_READS = [
	"users",
	"user_settings",
	"chats",
	"chat_messages",
	"connections",
	"prompt_configs",
	"narrator_prompt_configs",
	"context_configs",
	"world_lore_entries",
	"character_lore_entries",
	"history_entries",
	"character_gallery_images",
	"persona_gallery_images",
	"characters"
]

let entryDays: string[] = []
let galleryDays: Row[] = []

/** The previews of the first boot, taken before any test touches the database. */
const firstBoot: Record<number, PreviewOutcome> = {}
let firstState: Awaited<ReturnType<typeof configurationState>>
const PREVIEWED = [ids.chats.visibility, 34, ids.chats.bard, ids.chats.solo, 48]

beforeAll(async () => {
	placeFixture("big")
	db = await bootFixture()
	expect(await atticExists(db)).toBe(true)
	for (const t of ATTIC_READS)
		before[t] = await q(`SELECT * FROM "${ATTIC_SCHEMA}"."${t}" ORDER BY 1`)
	entryDays = (
		await q(
			["world_lore_entries", "character_lore_entries", "history_entries"]
				.map((t) => `SELECT to_char(created_at, 'YYYY-MM-DD') AS d FROM "${ATTIC_SCHEMA}"."${t}"`)
				.join(" UNION ")
				.concat(" ORDER BY 1")
		)
	).map((r) => r.d)
	galleryDays = await q(
		`SELECT id, character_id, to_char(created_at, 'YYYY-MM-DD') AS d FROM "${ATTIC_SCHEMA}".character_gallery_images ORDER BY id`
	)
	await runUpgradeTasks(db)
	// The previews compare with the second boot's, so they must read the same
	// derived state it will: a SETTLED annotation index (entity search ships
	// on, R5, and every turn queues its session on the annotation lane), and
	// the transcript cut an earlier turn holds (transcriptFit's held cut is
	// process memory, and the first preview of a long session is the one that
	// makes it, so its notice reads differently). A preview writes no row of
	// its own, so a warm-up pass changes only that derived state.
	// ⚠ Not for budgets any more: the turn hold (indexing/turnHold.ts) keeps
	// the lane's PGlite work out of a turn's way. A run without this warm-up
	// (2026-10-03) had no step time out; only the held-cut notice differed.
	for (const id of PREVIEWED) await previewTurn(db, id)
	const { settleAnnotationQueue } = await import("$lib/server/annotations/queue")
	await settleAnnotationQueue()
	for (const id of PREVIEWED) firstBoot[id] = await previewTurn(db, id)
	await settleAnnotationQueue()
	firstState = await configurationState(db)
}, 900_000)

/** 0.5.3's seeded reply default, which 0.6 no longer ships as the respond default. */
const SHIPPED_053_REPLY = "migrated:core:spec/respond:prompt-roleplay-simple"

const ownerOf = (chatId: number) => before.chats.find((c) => c.id === chatId)!.user_id
const adminSessions = () => before.chats.filter((c) => c.user_id === ids.users.admin).map((c) => c.id)

/** spec slug → scope → scope id → the selected config's seed key. */
async function selections(slug: string) {
	return q(
		`SELECT s.scope_kind, s.scope_id, c.seed_key, c.name FROM pipeline_config_selections s
		 JOIN pipeline_specs p ON p.id = s.spec_id JOIN pipeline_configs c ON c.id = s.config_id
		 WHERE p.slug = $1 ORDER BY s.scope_kind, s.scope_id`,
		slug
	)
}

describe("the first boot compiles every session's prompt (B2)", () => {
	test("sessions on a migrated configuration preview through to the model call", () => {
		for (const id of PREVIEWED) {
			const p = firstBoot[id]
			expect(p.halt, `session ${id}: ${p.reason}`).toBe("generate")
			expect(p.reason, `session ${id}`).toMatch(/preview/)
		}
	})
})

describe("each person's 0.5.3 picks select at session scope (B1)", () => {
	test("the admin's prompt config writes the admin's sessions, through the shipped context template", () => {
		for (const id of [ids.chats.visibility, 34, ids.chats.solo]) {
			expect(ownerOf(id)).toBe(ids.users.admin)
			const text = firstBoot[id].text
			expect(text, `session ${id}`).toContain("Write vividly")
			expect(text, `session ${id}`).not.toContain("tersely")
			// "My context" was the admin's pick; context configs are not carried.
			expect(text, `session ${id}`).not.toContain("<char>")
		}
	})

	test("another person's sessions keep the prompt 0.5.3 defaulted them to", () => {
		for (const id of [ids.chats.bard, 48]) {
			expect(ownerOf(id)).not.toBe(ids.users.admin)
			const text = firstBoot[id].text
			expect(text, `session ${id}`).toContain("never-ending uncensored roleplay")
			expect(text, `session ${id}`).not.toContain("Write vividly")
			expect(text, `session ${id}`).not.toContain("<char>")
		}
	})

	test("reply, narration and every summarizer select the admin's configs on each admin session, and nowhere else", async () => {
		const admin = new Set(adminSessions())
		const picks: Record<string, string> = {
			"core:spec/respond": `migrated:core:spec/respond:${ids.legacyConfigs.prompt}`,
			"core:spec/narrate": `migrated:core:spec/narrate:${ids.legacyConfigs.narrator}`,
			"core:spec/summarize-world": `migrated:core:spec/summarize-world:${ids.legacyConfigs.world}`,
			"core:spec/summarize-character": `migrated:core:spec/summarize-character:${ids.legacyConfigs.character}`,
			"core:spec/summarize-scene": `migrated:core:spec/summarize-scene:${ids.legacyConfigs.scene}`,
			"core:spec/summarize-history": `migrated:core:spec/summarize-history:${ids.legacyConfigs.scene}`
		}
		for (const [slug, seedKey] of Object.entries(picks)) {
			const rows = await selections(slug)
			expect(rows.filter((r) => r.scope_kind === "pub"), slug).toEqual([])
			const bySession = new Map(rows.map((r) => [r.scope_id, r.seed_key]))
			for (const id of admin) expect(bySession.get(id), `${slug} session ${id}`).toBe(seedKey)
			// The narrator is the one chat-level config 0.5.3 read.
			const narratorOverrides = before.chats
				.filter((c) => !admin.has(c.id) && c.narrator_prompt_config_id != null)
				.map((c) => c.id)
			// 0.6 ships a different reply default, so every other existing session
			// keeps 0.5.3's shipped prompt by its own selection.
			const others = rows.filter((r) => !admin.has(r.scope_id))
			if (slug === "core:spec/respond") {
				const theirs = before.chats.filter((c) => !admin.has(c.id)).map((c) => c.id)
				expect(others.map((r) => r.scope_id), slug).toEqual(theirs)
				for (const r of others) expect(r.seed_key, `session ${r.scope_id}`).toBe(SHIPPED_053_REPLY)
				continue
			}
			expect(others.map((r) => r.scope_id), slug).toEqual(slug === "core:spec/narrate" ? narratorOverrides : [])
		}
		const graph = await selections("core:spec/graph-build")
		expect(graph.map((r) => [r.scope_kind, r.seed_key])).toEqual([
			["pub", `migrated:core:spec/graph-build:${ids.legacyConfigs.graph}`]
		])
	})

	test("the resolver answers the same: narration and summaries use the picked configs", async () => {
		const { resolveSelectedConfig } = await import("$lib/server/pipelines/config/named")
		const specs = await q(`SELECT id, slug FROM pipeline_specs`)
		const spec = (slug: string) => specs.find((s) => s.slug === slug)!
		const resolved = async (slug: string, sessionId: number) =>
			(await resolveSelectedConfig(db, spec(slug).id, slug, { sessionId }))?.name
		expect(await resolved("core:spec/narrate", ids.chats.solo)).toBe("My narrator")
		expect(await resolved("core:spec/summarize-world", ids.chats.solo)).toBe("My world summarizer")
		expect(await resolved("core:spec/summarize-scene", ids.chats.solo)).toBe("My scene summarizer")
		expect(await resolved("core:spec/narrate", ids.chats.bard)).not.toBe("My narrator")
	})
})

describe("a chat's own prompt config (\"AI Override\") is carried, never selected (M5)", () => {
	test("no session selects a chat's prompt override, and a note lists each one", async () => {
		const overridden = before.chats.filter((c) => c.prompt_config_id != null)
		expect(overridden.length).toBeGreaterThan(0)
		const respond = new Map((await selections("core:spec/respond")).map((r) => [r.scope_id, r.seed_key]))
		for (const c of overridden) {
			const expected =
				c.user_id === ids.users.admin
					? `migrated:core:spec/respond:${ids.legacyConfigs.prompt}`
					: SHIPPED_053_REPLY
			expect(respond.get(c.id), `session ${c.id}`).toBe(expected)
		}
		// The terse override is still a configuration someone can pick.
		const terse = await one(`SELECT name FROM pipeline_configs WHERE seed_key = $1`, `migrated:core:spec/respond:${ids.legacyConfigs.prompt2}`)
		expect(terse.name).toBe("Terse prompt")
		const notes = await q(`SELECT object_label, summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'prompt-override'`)
		expect(notes).toHaveLength(overridden.length)
		for (const c of overridden)
			expect(notes.some((n) => n.summary.includes(`"${c.name}"`)), c.name).toBe(true)
	})
})

describe("prompt text only (owner ruling, 2026-10-01)", () => {
	test("a migrated config differs from the shipped default by its prompts alone", async () => {
		expect(await q(`SELECT name FROM pipeline_configs WHERE name LIKE '%(customized)%'`)).toEqual([])
		const migrated = await q(
			`SELECT c.id, c.spec_id FROM pipeline_configs c WHERE c.seed_key LIKE 'migrated:%'`
		)
		expect(migrated.length).toBeGreaterThan(0)
		for (const c of migrated) {
			const differs = await q(
				`SELECT v.node_key, v.slot, v.path FROM pipeline_config_values v
				 JOIN pipeline_configs d ON d.spec_id = $2 AND d.seed_key LIKE 'pipeline-default:%'
				 LEFT JOIN pipeline_config_values w ON w.config_id = d.id AND w.node_key = v.node_key AND w.slot = v.slot AND w.path = v.path
				 WHERE v.config_id = $1 AND (w.id IS NULL OR w.value::text <> v.value::text)`,
				c.id,
				c.spec_id
			)
			expect(differs.filter((r) => r.slot !== "prompts"), `config ${c.id}`).toEqual([])
		}
		expect(await q(`SELECT scope_id FROM pipeline_node_overrides WHERE path <> 'searchByMeaning'`)).toEqual([])
		// A pub that only defaulted to a shipped 0.5.3 prompt follows 0.6's shipped default.
		const pub = await q(
			`SELECT s.scope_id FROM pipeline_config_selections s JOIN pipeline_specs p ON p.id = s.spec_id WHERE p.slug = 'core:spec/respond' AND s.scope_kind = 'pub'`
		)
		expect(pub).toEqual([])
	})

	test("no 0.5.3 context config is carried", async () => {
		for (const c of before.context_configs) {
			const rows = await q(`SELECT id FROM pipeline_context_templates WHERE name = $1 AND NOT is_immutable`, c.name)
			expect(rows, c.name).toEqual([])
		}
	})

	test("each dropped customisation is an accepted loss, naming the configs", async () => {
		const notes = await q(
			`SELECT object_label, summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'accepted-loss'`
		)
		const byLabel = new Map(notes.map((n) => [n.object_label, n.summary]))
		expect(byLabel.get("post-history settings on configs")).toContain('"My prompt"')
		expect(byLabel.get("connection and sampling picks on configs")).toContain('"My world summarizer"')
		expect(byLabel.get("context configs")).toContain('"My context"')
	})
})

describe("llmman (M3)", () => {
	test("an llmman connection's model is on the Ollama connection at its address, options and all", async () => {
		const old = before.connections.find((c) => c.id === ids.connections.llmman)!
		// The fixture's Ollama row is at the same address, so the two are one
		// endpoint; the llmman row's options ride on its model where they differ.
		const model = await one(`SELECT * FROM connection_models WHERE model = $1`, old.model)
		const c = await one(`SELECT * FROM connections WHERE id = $1`, model.connection_id)
		expect(c.type).toBe("ollama")
		expect(c.base_url).toBe(old.base_url)
		const sent = { ...c.extra_json, ...model.extra_json }
		expect(sent.think).toBe(old.extra_json.think)
		expect(sent.useChat).toBe(old.extra_json.useChat)
		expect(sent.stream).toBe(old.extra_json.stream)
		const note = await one(
			`SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'connection-converted' AND object_label = $1`,
			old.name
		)
		expect(note.summary).toMatch(/Ollama/)
	})
})

describe("ragIgnored (M4)", () => {
	test("a chat that ignored retrieval has search-by-meaning off, and keeps its flag", async () => {
		const ignored = before.chats.filter((c) => c.metadata?.ragIgnored === true).map((c) => c.id)
		expect(ignored.length).toBeGreaterThan(0)
		const rows = await q(
			`SELECT o.scope_id, o.value, p.slug FROM pipeline_node_overrides o JOIN pipeline_specs p ON p.id = o.spec_id
			 WHERE o.scope_kind = 'session' AND o.slot = 'params' AND o.path = 'searchByMeaning'`
		)
		const respond = rows.filter((r) => r.slug === "core:spec/respond")
		expect(respond.map((r) => r.scope_id).sort((a, b) => a - b)).toEqual(ignored)
		expect(rows.every((r) => r.value === "off")).toBe(true)
		for (const id of ignored)
			expect((await one(`SELECT metadata FROM sessions WHERE id = $1`, id)).metadata.ragIgnored).toBe(true)
	})
})

describe("restore repairs and small carries", () => {
	test("entry vectors are stamped against the text they were computed on: a rewritten cast tag re-embeds once", async () => {
		const identity = ids.embedding.configuredModel.m
		const single = /(?<!\{)\{char:[0-9]+\}(?!\})/
		const rewritten = ["world_lore_entries", "character_lore_entries", "history_entries"].flatMap((t) =>
			before[t].filter(
				(e) =>
					e.embedding_model === identity &&
					e.embedding?.length === 384 &&
					[e.content, e.name, e.keys].some((v) => typeof v === "string" && single.test(v))
			)
		)
		const stale = await one(
			`SELECT count(*)::int AS n FROM lorebook_entry_vectors v JOIN lorebook_entries e ON e.id = v.entry_id
			 WHERE v.source_hash IS DISTINCT FROM e.embed_text_hash`
		)
		expect(stale.n).toBe(rewritten.length)
	})

	test("entries created the same 0.5.3 day keep their order and stop tying (date → timestamp)", async () => {
		// 0.5.3 dated entries by day; 0.6 stamps them to the microsecond. The
		// session and message columns are still dates in 0.6, so only the
		// entries (and gallery files, below) cross from a day to an instant.
		const ties = await one(
			`SELECT count(*)::int AS n FROM (
				SELECT created_at AS at, lag(created_at) OVER (PARTITION BY created_at::date ORDER BY id) AS prev
				FROM lorebook_entries
			) x WHERE prev IS NOT NULL AND at <= prev`
		)
		expect(ties.n).toBe(0)
		const live = (await q(`SELECT DISTINCT to_char(created_at, 'YYYY-MM-DD') AS d FROM lorebook_entries ORDER BY 1`)).map((r) => r.d)
		expect(live).toEqual(entryDays)
	})

	test("gallery images keep their 0.5.3 dates", async () => {
		expect(galleryDays.length).toBeGreaterThan(0)
		for (const g of galleryDays) {
			const f = await q(
				`SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS at FROM files WHERE character_id = $1`,
				g.character_id
			)
			expect(f.map((r) => r.at), `gallery ${g.id}`).toContain(`${g.d} 00:00:00`)
		}
	})

	test("the easy-persona switch, which 0.6 has no place for, is an accepted loss", async () => {
		const off = before.user_settings.filter((s) => s.enable_easy_persona_creation === false)
		expect(off.length).toBeGreaterThan(0)
		const note = await one(
			`SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'accepted-loss' AND object_label LIKE '%persona creation%'`
		)
		expect(note.summary).toMatch(new RegExp(`^${off.length} ×`))
	})
})

describe("the second boot changes nothing the first wrote", () => {
	test("defaults sync and every startup task again: configurations, selections, connections, sampling, repairs", async () => {
		const { sync } = await import("$lib/server/db/defaults")
		await sync()
		await runUpgradeTasks(db)
		const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
		await bootstrapPipelines(db)
		const second = await configurationState(db)
		for (const key of Object.keys(firstState) as Array<keyof typeof firstState>)
			expect(second[key], key).toEqual(firstState[key])
		const { settleAnnotationQueue } = await import("$lib/server/annotations/queue")
		for (const id of [ids.chats.visibility, 34]) {
			await settleAnnotationQueue()
			const p = await previewTurn(db, id)
			expect(p.text).toBe(firstBoot[id].text)
		}
	}, 600_000)
})
