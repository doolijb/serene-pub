/**
 * The 0.5.3 → 0.6 upgrade, end to end, over the big fixture
 * (`db/fixtures/0.5.3/`, its MANIFEST.json planting 70 edge cases): the app's
 * own boot — pre-migration backup, migrations with the attic stash,
 * `defaults.sync()` — then the startup tasks the upgrade spans, in their
 * order (plan §6.1).
 *
 * Everything asserted against the 0.5.3 side is read from the attic before
 * the upgrade runs, because the upgrade ends by dropping it.
 *
 * It also carries the upgrade cases of the migration suites that died with
 * the pre-squash chain (plan §3.3): persona merge (0132/0133), cast tag repair
 * (0200/0201), embeddings as connections (0127), the endpoint/model split and
 * completion templates (0096/0097/0114), the llama.cpp type (0105), history
 * date bounds (0198), entry checks, envoy seats (0138), and "a row migrated
 * from 0.5 gets no core: template id".
 */
import { beforeAll, describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import { splitKeys } from "$lib/server/pipelines/ranking/signals"
import { bootFixture, fixtureManifest, placeFixture, runUpgradeTasks } from "./testFixture"
import { ATTIC_SCHEMA, atticExists } from "./index"
import { STRATEGY_REBINDS } from "./finish"

const manifest = fixtureManifest("big")
const ids = manifest.ids
let db: Db
let appDataDir: string
let run: Awaited<ReturnType<typeof runUpgradeTasks>>

type Row = any
const q = async (text: string, ...params: unknown[]): Promise<Row[]> => {
	const client = (db as any).$client
	return (await client.query(text, params)).rows
}
const one = async (text: string, ...params: unknown[]): Promise<Row> =>
	(await q(text, ...params))[0]
const count = async (from: string) =>
	Number((await one(`SELECT count(*)::int AS n FROM ${from}`)).n)

/** The 0.5.3 side, read from the attic before the upgrade drops it. */
const before: Record<string, Row[]> = {}
const ATTIC_READS = [
	"users",
	"personas",
	"characters",
	"chats",
	"chat_characters",
	"chat_personas",
	"chat_messages",
	"lorebook_bindings",
	"world_lore_entries",
	"character_lore_entries",
	"history_entries",
	"sampling_configs",
	"connections",
	"system_settings",
	"scenes",
	"narrative_relationships",
	"persona_tags",
	"character_tags",
	"tags",
	"prompt_configs",
	"narrator_prompt_configs",
	"world_summarize_configs",
	"character_summarize_configs",
	"scene_summarize_configs",
	"graph_build_configs",
	"context_configs",
	"koboldcpp_models",
	"binding_merge_logs"
]

beforeAll(async () => {
	;({ appDataDir } = placeFixture("big"))
	db = await bootFixture()
	expect(await atticExists(db)).toBe(true)
	for (const t of ATTIC_READS)
		before[t] = await q(`SELECT * FROM "${ATTIC_SCHEMA}"."${t}" ORDER BY 1`)
	run = await runUpgradeTasks(db)
}, 900_000)

describe("the upgrade completes", () => {
	test("the reconciliation accounts for every 0.5.3 table", () => {
		expect(run.restore?.alreadyRestored).toBe(false)
		const lines = run.restore!.reconciliation
		expect(lines.filter((l) => l.expected !== l.actual)).toEqual([])
		const byTable = Object.fromEntries(lines.map((l) => [l.table, l.actual]))
		const c = manifest.counts
		expect(byTable.users).toBe(c.users)
		expect(byTable.sessions).toBe(c.chats)
		expect(byTable.session_messages).toBe(c.chat_messages)
		expect(byTable.characters).toBe(c.characters + c.personas)
		expect(byTable.lorebook_entries).toBe(
			c.world_lore_entries + c.character_lore_entries + c.history_entries
		)
		expect(byTable.lorebooks).toBe(c.lorebooks)
		expect(byTable.tags).toBe(c.tags)
		expect(byTable.passphrases).toBe(c.passphrases)
		expect(byTable.user_tokens).toBe(c.user_tokens)
		expect(byTable.session_guests).toBe(c.chat_guests)
		expect(byTable.session_characters).toBe(c.chat_characters)
		expect(byTable.session_personas).toBe(c.chat_personas)
		expect(byTable.session_tags).toBe(c.chat_tags)
		expect(byTable.custom_themes).toBe(c.custom_themes)
		expect(byTable.local_models).toBe(c.koboldcpp_models)
		expect(byTable.binding_merge_logs).toBe(c.binding_merge_logs)
		// One fewer than 0.5.3 had — the llmman row reaches the same Ollama as
		// the Ollama row, so its model joined that connection — and one more:
		// the embedding singleton's.
		expect(byTable.connections).toBe(c.connections - 1 + 1)
	})

	test("the attic is dropped once the wiring has run", async () => {
		expect(run.wiring).not.toBeNull()
		expect(await atticExists(db)).toBe(false)
	})

	test("the 0.5.3 messages are projected into the message model, ids equal", async () => {
		expect(run.messages.migrated).toBe(manifest.counts.chat_messages)
		expect(await count("messages")).toBe(manifest.counts.chat_messages)
		const stray = await one(
			`SELECT count(*)::int AS n FROM messages m LEFT JOIN session_messages s ON s.id = m.id WHERE s.id IS NULL`
		)
		expect(stray.n).toBe(0)
	})

	test("every identity sequence is past its table's highest id, except messages'", async () => {
		const seqs = await q(`
			SELECT seq.relname AS seq, tab.relname AS tab, attr.attname AS col
			FROM pg_class seq JOIN pg_namespace ns ON ns.oid = seq.relnamespace
			JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a','i')
			JOIN pg_class tab ON dep.refobjid = tab.oid
			JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
			WHERE seq.relkind = 'S' AND ns.nspname = 'public' AND tab.relname <> 'messages'`)
		const behind: string[] = []
		for (const s of seqs) {
			const r = await one(
				`SELECT last_value::int AS last, is_called AS called, (SELECT max("${s.col}")::int FROM public."${s.tab}") AS top FROM public."${s.seq}"`
			)
			const next = r.called ? r.last + 1 : r.last
			if (r.top != null && next <= r.top) behind.push(`${s.tab}: next ${next} ≤ ${r.top}`)
		}
		expect(behind).toEqual([])
	})

	test("the entry-type CHECKs project and validate over the upgraded entries", () => {
		const projection = run.pipelines.entryProjection as any
		expect(projection?.errors ?? []).toEqual([])
		expect(projection?.violations ?? []).toEqual([])
	})

	test("a second boot is a no-op", async () => {
		const counts = {
			sessions: await count("sessions"),
			characters: await count("characters"),
			entries: await count("lorebook_entries"),
			logbook: await count("admin_logbook")
		}
		const again = await runUpgradeTasks(db)
		expect(again.restore).toBeNull()
		expect(again.wiring).toBeNull()
		expect(again.messages.migrated).toBe(0)
		expect({
			sessions: await count("sessions"),
			characters: await count("characters"),
			entries: await count("lorebook_entries"),
			logbook: await count("admin_logbook")
		}).toEqual(counts)
	}, 300_000)
})

describe("users and sign-in", () => {
	test("users keep their ids, admin flags and passwords", async () => {
		const users = await q(`SELECT id, username, is_admin, seed_key FROM users ORDER BY id`)
		expect(users.map((u) => [u.id, u.username, u.is_admin])).toEqual(
			before.users.map((u) => [u.id, u.username, u.is_admin])
		)
		expect(users.find((u) => u.id === 1)?.seed_key).toBe("user-admin")
		const { validate } = await import("$lib/server/providers/users/passphrase/validate")
		for (const [name, [username, passphrase]] of Object.entries(manifest.credentials!)) {
			const id = ids.users[name]
			expect((await one(`SELECT username FROM users WHERE id = $1`, id)).username).toBe(username)
			expect(await validate({ userId: String(id), passphrase })).toBe(true)
			expect(await validate({ userId: String(id), passphrase: passphrase + "x" })).toBe(false)
		}
	})

	test("accounts stay enabled and sign-in tokens carry over", async () => {
		const s = await one(`SELECT is_accounts_enabled FROM system_settings`)
		expect(s.is_accounts_enabled).toBe(true)
		expect(await count("user_tokens")).toBe(manifest.counts.user_tokens)
	})

	test("the admin's settings row is the seeded one, updated with 0.5.3's values", async () => {
		const rows = await q(`SELECT * FROM user_settings WHERE user_id = 1`)
		expect(rows).toHaveLength(1)
		expect(rows[0].theme).toBe("cerberus")
		expect(rows[0].background_opacity).toBe(60)
		expect(rows[0].show_all_character_fields).toBe(true)
	})
})

describe("characters and personas (0132/0133 persona merge)", () => {
	test("characters keep their ids and fields; personas are is_persona characters", async () => {
		const chars = await q(`SELECT * FROM characters WHERE NOT is_persona ORDER BY id`)
		expect(chars.map((c) => c.id)).toEqual(before.characters.map((c) => c.id))
		const personas = await q(`SELECT * FROM characters WHERE is_persona ORDER BY id`)
		expect(personas.map((p) => p.name)).toEqual(before.personas.map((p) => p.name))
		const fav = chars.find((c) => c.id === 2)
		expect(fav?.is_favorite).toBe(true)
		expect(chars.find((c) => c.id === 14)?.is_deleted).toBe(true)
		expect(chars.find((c) => c.id === 71)?.is_deleted).toBe(true)
	})

	test("a persona sharing a character's uuid gets a fresh one", async () => {
		const shared = before.personas.find((p) =>
			before.characters.some((c) => c.user_id === p.user_id && c.uuid === p.uuid)
		)
		expect(shared).toBeDefined()
		const row = await one(`SELECT uuid FROM characters WHERE is_persona AND name = $1`, shared!.name)
		expect(row.uuid).not.toBe(shared!.uuid)
	})

	test("one default persona per user — the lowest id", async () => {
		const defaults = await q(`SELECT user_id, name FROM characters WHERE is_default_persona ORDER BY user_id`)
		expect(defaults.map((d) => d.name)).toEqual(["Master Desir", "Lute", "Pip"])
	})

	test("persona tags became character tags", async () => {
		for (const t of before.persona_tags) {
			const name = before.personas.find((p) => p.id === t.persona_id)!.name
			const r = await one(
				`SELECT count(*)::int AS n FROM character_tags ct JOIN characters c ON c.id = ct.character_id
				 WHERE c.is_persona AND c.name = $1 AND ct.tag_id = $2`,
				name,
				t.tag_id
			)
			expect(r.n).toBe(1)
		}
	})

	test("the chats still voice their personas", async () => {
		const voiced = await one(
			`SELECT count(*)::int AS n FROM session_messages m JOIN characters c ON c.id = m.persona_id WHERE c.is_persona`
		)
		expect(voiced.n).toBe(manifest.detail.messages.persona_authored)
		const seats = await one(
			`SELECT count(*)::int AS n FROM session_personas sp JOIN characters c ON c.id = sp.persona_id WHERE c.is_persona`
		)
		expect(seats.n).toBe(before.chat_personas.filter((p) => p.persona_id != null).length)
	})

	test("avatars, galleries and the uploaded background are media with a readable file", async () => {
		const withAvatar = [
			...before.characters.filter((c) => c.avatar).map((c) => ["c", c.name]),
			...before.personas.filter((p) => p.avatar).map((p) => ["p", p.name])
		]
		expect(withAvatar.length).toBeGreaterThan(0)
		for (const [kind, name] of withAvatar) {
			const row = await one(
				`SELECT v.path FROM characters c JOIN files f ON f.id = c.avatar_media_id
				 JOIN variants v ON v.file_id = f.id AND v.variant = 'original'
				 WHERE c.name = $1 AND c.is_persona = $2`,
				name,
				kind === "p"
			)
			expect(row?.path, `${name}'s avatar`).toBeTruthy()
			expect(fs.existsSync(path.join(appDataDir, row.path))).toBe(true)
		}
		const gallery = await one(
			`SELECT count(*)::int AS n FROM files WHERE character_id IN (1, 2, 3, 4)`
		)
		expect(gallery.n).toBeGreaterThanOrEqual(12)
		const bg = await one(`SELECT background_media_id, background_image_path FROM user_settings WHERE user_id = 1`)
		expect(bg.background_media_id).not.toBeNull()
		expect(bg.background_image_path).toBeNull()
	})
})

describe("lorebooks (cast tag repair 0200/0201, binding merge, entries)", () => {
	test("entries become typed rows, in 0.5.3's order, keys split by 0.5.3's rule", async () => {
		const typeCounts = await q(`SELECT type_id, count(*)::int AS n FROM lorebook_entries GROUP BY type_id`)
		const by = Object.fromEntries(typeCounts.map((r) => [r.type_id, r.n]))
		expect(by["core:entry/world-lore"]).toBe(manifest.counts.world_lore_entries)
		expect(by["core:entry/character-lore"]).toBe(manifest.counts.character_lore_entries)
		expect(by["core:entry/history"]).toBe(manifest.counts.history_entries)

		for (const w of before.world_lore_entries.filter((e) => [3, 194, 196, 199].includes(e.id))) {
			const live = await one(
				`SELECT keys FROM lorebook_entries WHERE type_id = 'core:entry/world-lore' AND lorebook_id = $1 AND title = $2 AND content = $3`,
				w.lorebook_id,
				w.name,
				w.content
			)
			expect(live.keys).toEqual(splitKeys(w.keys))
			expect(live.keys.every((k: string) => k.length > 0 && k === k.trim())).toBe(true)
		}
		const dupPositions = await one(
			`SELECT count(*)::int AS n FROM (SELECT lorebook_id, type_id, position FROM lorebook_entries GROUP BY 1,2,3 HAVING count(*) > 1) d`
		)
		expect(dupPositions.n).toBe(0)
		const minPos = await one(`SELECT min(position)::int AS m FROM lorebook_entries`)
		expect(minPos.m).toBe(1)
	})

	test("a row migrated from 0.5 is human-written and names a declared entry type", async () => {
		const r = await one(
			`SELECT count(*)::int AS n FROM lorebook_entries WHERE provenance <> 'human' OR type_id NOT LIKE 'core:entry/%' OR type_version <> 1`
		)
		expect(r.n).toBe(0)
	})

	test("priorities are inside the declared 1–3", async () => {
		const r = await one(
			`SELECT count(*)::int AS n FROM lorebook_entries WHERE (fields->>'priority')::int NOT BETWEEN 1 AND 3`
		)
		expect(r.n).toBe(0)
	})

	test("history dates follow the story-time rule; years are kept as written (0198)", async () => {
		const expected: Record<number, [number, number | null, number | null]> = {
			685: [0, 1, 5],
			676: [-3, 4, 1],
			667: [10, null, null],
			658: [11, 1, 9],
			649: [12, 13, 2],
			640: [13, 2, null],
			631: [14, 5, 32]
		}
		for (const [oldId, [year, month, day]] of Object.entries(expected)) {
			const h = before.history_entries.find((e) => e.id === Number(oldId))!
			const live = await one(
				`SELECT fields FROM lorebook_entries WHERE type_id = 'core:entry/history' AND lorebook_id = $1 AND content = $2 AND (fields->>'year')::int = $3`,
				h.lorebook_id,
				h.content,
				h.year
			)
			expect(live.fields.year).toBe(year)
			expect(live.fields.month ?? null).toBe(month)
			expect(live.fields.day ?? null).toBe(day)
		}
		const dayNoMonth = await one(
			`SELECT count(*)::int AS n FROM lorebook_entries WHERE type_id = 'core:entry/history' AND fields ? 'day' AND NOT fields ? 'month'`
		)
		expect(dayNoMonth.n).toBe(0)
	})

	test("every binding tag is {{char:N}} and unique in its book", async () => {
		const bad = await one(
			`SELECT count(*)::int AS n FROM lorebook_bindings WHERE binding !~ '^\\{\\{char:[0-9]+\\}\\}$'`
		)
		expect(bad.n).toBe(0)
		const dup = await one(
			`SELECT count(*)::int AS n FROM (SELECT lorebook_id, binding FROM lorebook_bindings GROUP BY 1,2 HAVING count(*) > 1) d`
		)
		expect(dup.n).toBe(0)
		const single = await one(
			`SELECT count(*)::int AS n FROM lorebook_entries WHERE content ~ '(?<![{])\\{char:[0-9]+\\}(?![}])'`
		)
		expect(single.n).toBe(0)
	})

	test("two bindings of one character in a book merge into the lowest id", async () => {
		expect((await one(`SELECT count(*)::int AS n FROM lorebook_bindings WHERE id = 34`)).n).toBe(0)
		expect((await one(`SELECT character_id FROM lorebook_bindings WHERE id = 1`)).character_id).toBe(1)
		const dup = await one(
			`SELECT count(*)::int AS n FROM (SELECT lorebook_id, character_id FROM lorebook_bindings WHERE character_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d`
		)
		expect(dup.n).toBe(0)
	})

	test("a persona binding binds the persona's character", async () => {
		const p1 = await one(`SELECT id FROM characters WHERE is_persona AND name = 'Warren'`)
		expect((await one(`SELECT character_id FROM lorebook_bindings WHERE id = 3`)).character_id).toBe(p1.id)
	})

	test("graph links point at the remapped history entries", async () => {
		const scenes = await q(
			`SELECT s.id, e.type_id FROM scenes s JOIN lorebook_entries e ON e.id = s.history_entry_id`
		)
		expect(scenes.length).toBe(await count("scenes"))
		expect(scenes.every((s) => s.type_id === "core:entry/history")).toBe(true)
		expect(await count("scenes")).toBe(manifest.counts.scenes)
		const rels = await one(
			`SELECT count(*)::int AS n FROM narrative_relationships r LEFT JOIN lorebook_entries e ON e.id = r.history_entry_id
			 WHERE r.history_entry_id IS NOT NULL AND (e.id IS NULL OR e.type_id <> 'core:entry/history')`
		)
		expect(rels.n).toBe(0)
		const b14 = await one(
			`SELECT e.type_id, b.parent_node_id FROM lorebook_bindings b JOIN lorebook_entries e ON e.id = b.history_entry_id WHERE b.id = 14`
		)
		expect(b14.type_id).toBe("core:entry/history")
		expect(b14.parent_node_id).toBe(11)
	})

	test("the merge log names the moved character lore by its new id (D5)", async () => {
		const old = before.binding_merge_logs[0]
		expect(old.reassigned_character_lore_entry_ids.length).toBeGreaterThan(0)
		const log = await one(
			`SELECT reassigned_character_lore_entry_ids AS ids, survivor_id FROM binding_merge_logs WHERE id = $1`,
			old.id
		)
		expect(log.survivor_id).toBe(old.survivor_id)
		expect(log.ids.length).toBe(old.reassigned_character_lore_entry_ids.length)
		for (const id of log.ids) {
			const e = await one(`SELECT type_id FROM lorebook_entries WHERE id = $1`, id)
			expect(e.type_id).toBe("core:entry/character-lore")
		}
	})
})

describe("sessions", () => {
	test("every chat is a Chat session under its own id", async () => {
		const sessions = await q(`SELECT * FROM sessions ORDER BY id`)
		expect(sessions.map((s) => s.id)).toEqual(before.chats.map((c) => c.id))
		expect(sessions.every((s) => s.genre_id === "core:genre/chat" && s.preset_id === null)).toBe(true)
		const summarize = sessions.find((s) => s.id === ids.chats.summarize)
		expect(summarize.session_type).toBe("summarize")
		for (const c of before.chats) {
			const s = sessions.find((x) => x.id === c.id)
			expect(s.is_group).toBe(c.is_group)
			expect(s.name).toBe(c.name)
			expect(s.lorebook_id).toBe(c.lorebook_id)
		}
		const drafts = sessions.find((s) => s.id === ids.chats.solo).drafts
		expect(Object.keys(drafts).length).toBeGreaterThan(0)
	})

	test("character detail is the most verbose of the chat's seats (D7)", async () => {
		const detail = async (id: number) =>
			(await one(`SELECT genre_fields FROM sessions WHERE id = $1`, id)).genre_fields.characterDetail ?? "full"
		expect(await detail(ids.chats.visibility)).toBe("full")
		expect(await detail(ids.chats.allHidden)).toBe("speaker-only")
		expect(await detail(ids.chats.allMinimal)).toBe("brief")
	})

	test("a manual or user-split chat's session rebinds its turn order (D8)", async () => {
		const rebinds = await q(
			`SELECT r.scope_id, r.node_key, r.definition_id, s.slug FROM pipeline_node_rebinds r JOIN pipeline_specs s ON s.id = r.spec_id WHERE r.scope_kind = 'session'`
		)
		const expected = before.chats.filter((c) => STRATEGY_REBINDS[c.group_reply_strategy])
		expect(rebinds).toHaveLength(expected.length)
		for (const c of expected) {
			const r = rebinds.find((x) => x.scope_id === c.id)
			expect(r?.definition_id).toBe(STRATEGY_REBINDS[c.group_reply_strategy])
			expect(r?.slug).toBe("core:spec/chat-turn-order")
			expect(r?.node_key).toBe("decide.rules.strategy")
		}
		expect(rebinds.find((r) => r.scope_id === ids.chats.manual)?.definition_id).toBe("core:task/turn-manual@1")
		expect(rebinds.find((r) => r.scope_id === ids.chats.userSplit)?.definition_id).toBe("core:task/turn-user-split@1")
		expect(rebinds.find((r) => r.scope_id === ids.chats.ordered)).toBeUndefined()
	})

	test("messages keep ids, swipes, reasoning, errors and hidden flags; derelict replies are settled", async () => {
		// 0.5.3's `thinking` / `swipes.thinkingHistory` arrive as `reasoning` /
		// `swipes.reasoningHistory` (NOMENCLATURE §23); nothing else moves.
		const as06 = (meta: Row) => {
			if (!meta) return meta
			const { thinking, swipes, ...rest } = meta
			const out: Row = { ...rest }
			if (thinking !== undefined) out.reasoning = thinking
			if (swipes) {
				const { thinkingHistory, ...swipeRest } = swipes
				out.swipes =
					thinkingHistory !== undefined
						? { ...swipeRest, reasoningHistory: thinkingHistory }
						: swipes
			}
			return out
		}
		const swiped = await one(`SELECT metadata FROM session_messages WHERE id = 13`)
		const old13 = before.chat_messages.find((m) => m.id === 13)!
		expect(swiped.metadata).toEqual(as06(old13.metadata))
		const hidden = await one(`SELECT count(*)::int AS n FROM session_messages WHERE is_hidden`)
		expect(hidden.n).toBe(manifest.detail.messages.hidden)
		const reasoning = await one(`SELECT count(*)::int AS n FROM session_messages WHERE metadata::jsonb ? 'reasoning' AND metadata->>'reasoning' IS NOT NULL`)
		const traced = before.chat_messages.filter((m) => m.metadata?.thinking != null)
		expect(traced.length).toBeGreaterThan(0)
		expect(reasoning.n).toBe(traced.length)
		const histories = await one(`SELECT count(*)::int AS n FROM session_messages WHERE metadata::jsonb->'swipes' ? 'reasoningHistory'`)
		expect(histories.n).toBe(
			before.chat_messages.filter((m) => m.metadata?.swipes?.thinkingHistory !== undefined).length
		)
		const retired = await one(`SELECT count(*)::int AS n FROM session_messages WHERE metadata::jsonb ? 'thinking' OR metadata::jsonb->'swipes' ? 'thinkingHistory'`)
		expect(retired.n).toBe(0)
		for (const id of [896, 1693]) {
			const m = await one(`SELECT is_generating, error, queue_item_id FROM session_messages WHERE id = $1`, id)
			expect(m.is_generating).toBe(false)
			expect(m.queue_item_id).toBeNull()
			expect(m.error?.message).toMatch(/restarted/)
		}
		const err = await one(`SELECT error FROM session_messages WHERE id = 1694`)
		expect(err.error).toEqual(before.chat_messages.find((m) => m.id === 1694)!.error)
		const channels = await one(`SELECT count(*)::int AS n FROM session_messages WHERE channel <> 'main'`)
		expect(channels.n).toBe(0)
	})

	test("guests, tags and the cast carry over; no seat is an envoy (0138)", async () => {
		expect(await count("session_guests")).toBe(manifest.counts.chat_guests)
		const envoys = await one(`SELECT count(*)::int AS n FROM session_characters WHERE envoy_slug IS NOT NULL`)
		expect(envoys.n).toBe(0)
		const removed = await one(`SELECT count(*)::int AS n FROM session_characters WHERE session_id = $1 AND removed_at IS NOT NULL`, ids.chats.removed)
		expect(removed.n).toBe(1)
	})
})

describe("connections and sampling (0096/0097/0105/0114/0127)", () => {
	test("connections to one service are one endpoint with a model each; types moved where 0.6 renamed them", async () => {
		const conns = await q(`SELECT * FROM connections ORDER BY id`)
		const byId = new Map(conns.map((c) => [c.id, c]))
		expect(byId.get(ids.connections.llamacpp).type).toBe("llamacpp")
		// The llmman row is an Ollama row at the Ollama row's address: one
		// endpoint, under the first row's id.
		expect(byId.has(ids.connections.llmman)).toBe(false)
		const ollama = byId.get(ids.connections.ollama)
		expect(ollama.type).toBe("ollama")
		expect(ollama.base_url).toBe(before.connections.find((c) => c.id === ids.connections.llmman)!.base_url)
		expect(byId.get(ids.connections.koboldManaged).type).toBe("koboldcpp_managed")
		const endpointOf = (id: number) => (id === ids.connections.llmman ? ids.connections.ollama : id)
		for (const c of before.connections) {
			const m = await q(
				`SELECT model FROM connection_models WHERE connection_id = $1 AND model = $2`,
				endpointOf(c.id),
				c.model
			)
			expect(m, c.name).toHaveLength(1)
			expect(Object.keys(byId.get(endpointOf(c.id)).capabilities.resolved ?? {}).length).toBeGreaterThan(0)
		}
		expect(await q(`SELECT model FROM connection_models WHERE connection_id = $1 ORDER BY id`, ollama.id)).toEqual([
			{ model: "fake-think:7b" },
			{ model: "gemma4" }
		])
		// Each named the way 0.6 names a new connection to its service.
		expect(conns.map((c) => c.name)).toEqual([
			"Custom (OpenAI-Compatible)",
			"Ollama",
			"LM Studio",
			"Llama.cpp",
			"KoboldCPP",
			"KoboldCPP on this machine",
			"Anthropic (Claude)",
			"Custom (OpenAI-Compatible) 2",
			"Embeddings (OpenAI-compatible)"
		])
	})

	test("the combined connection's second model keeps what its row set differently", async () => {
		const gemma = await one(`SELECT * FROM connection_models WHERE model = 'gemma4'`)
		expect(gemma.prompt_format).toBe("vicuna")
		expect(gemma.extra_json).toEqual({ think: false })
		const ollama = await one(`SELECT * FROM connections WHERE id = $1`, ids.connections.ollama)
		expect(ollama.prompt_format).toBe("chatml")
		expect(ollama.extra_json.think).toBe(true)
		const notes = await q(
			`SELECT object_id AS topic, object_label, summary FROM admin_logbook
			 WHERE object_type = 'data-upgrade' AND object_id IN ('connection-merged', 'connection-renamed')`
		)
		const merged = notes.filter((n) => n.topic === "connection-merged")
		expect(merged.map((n) => n.object_label)).toEqual(["Ollama"])
		expect(merged[0].summary).toContain('"Fake Ollama (thinking)" and "llmman local"')
		expect(notes.filter((n) => n.topic === "connection-renamed").map((n) => n.object_label).sort()).toEqual([
			"Anthropic (Claude)",
			"Custom (OpenAI-Compatible)",
			"Custom (OpenAI-Compatible) 2",
			"KoboldCPP on this machine",
			"Llama.cpp"
		])
	})

	test("prompt formats no template provides become no template (0097)", async () => {
		const pf = async (id: number) => (await one(`SELECT prompt_format FROM connections WHERE id = $1`, id)).prompt_format
		expect(await pf(ids.connections.kobold)).toBeNull()
		expect(await pf(ids.connections.dead)).toBeNull()
		expect(await pf(ids.connections.koboldManaged)).toBeNull()
		expect(await pf(ids.connections.openai)).toBe("chatml")
	})

	test("encrypted API keys still decrypt under the fixture's secret", async () => {
		const { decryptApiKeyField } = await import("$lib/server/utils/tokenCrypto")
		for (const id of [ids.connections.openai, ids.connections.anthropic]) {
			const c = await one(`SELECT extra_json FROM connections WHERE id = $1`, id)
			expect(c.extra_json.apiKey.__enc).toBe(true)
			const plain = decryptApiKeyField(c.extra_json.apiKey)
			expect(typeof plain).toBe("string")
			expect(plain!.length).toBeGreaterThan(0)
		}
	})

	test("the embedding singleton is a starred OpenAI-compatible connection that embeds, its key re-encrypted (0127)", async () => {
		const star = await one(`SELECT * FROM connection_defaults WHERE input = 'text' AND output = 'embedding'`)
		const emb = await one(`SELECT * FROM connections WHERE id = $1`, star.connection_id)
		// Restored as `openai-embeddings`, renamed onto `openai` in the same
		// restore (connections/openAIMultiModality.ts), embeddings switched on.
		expect(emb.type).toBe("openai")
		expect(emb.modality).toBe("text-gen")
		expect(emb.capabilities.overrides).toEqual({ "text->embedding": 1 })
		expect(Object.keys(emb.capabilities.resolved)).toContain("text->embedding")
		expect(emb.base_url).toBe(manifest.detail.vectorizationConfig.api_base_url)
		expect(emb.extra_json.__legacyVectorizationApiKey).toBeUndefined()
		const { decryptApiKeyField } = await import("$lib/server/utils/tokenCrypto")
		expect(decryptApiKeyField(emb.extra_json.apiKey)).toBeTruthy()
		const model = await one(`SELECT model, modality FROM connection_models WHERE id = $1`, star.connection_model_id)
		expect(model.model).toBe(manifest.detail.vectorizationConfig.api_model)
		expect(model.modality).toBe("embeddings")
	})

	test("the instance's default connection and sampling config are the text default", async () => {
		const d = await one(`SELECT * FROM connection_defaults WHERE input = 'text' AND output = 'text'`)
		expect(d.connection_id).toBe(manifest.detail.systemSettings.default_connection_id)
		const s = await one(`SELECT name FROM sampling_configs WHERE id = $1`, d.sampling_config_id)
		expect(s.name).toBe("Mirostat")
	})

	test("sampling configs: values and switches round-trip, colliding names are suffixed", async () => {
		const live = await q(`SELECT * FROM sampling_configs WHERE seed_key IS NULL ORDER BY id`)
		expect(live.map((r) => r.name)).toEqual(
			expect.arrayContaining(["Creative", "creative (2)", "Precise", "PRECISE (2)", "Mirostat", "Everything enabled", "Nothing enabled"])
		)
		const all = live.find((r) => r.name === "Everything enabled")
		const flat = before.sampling_configs.find((r) => r.name === "Everything enabled")!
		expect(all.values.temperature).toBeCloseTo(flat.temperature)
		expect(all.values.stop).toEqual(flat.stop)
		expect(all.values.logitBias).toEqual(flat.logit_bias)
		expect(all.values.drySequenceBreakers).toEqual(flat.dry_sequence_breakers)
		expect(all.enabled).toEqual(expect.arrayContaining(["temperature", "topP", "topK", "stop", "logitBias", "drySequenceBreakers"]))
		const none = live.find((r) => r.name === "Nothing enabled")
		expect(none.enabled).toEqual([])
		expect(none.values.topP).toBeUndefined()
		const mixed = await one(`SELECT sampling_config_id FROM sessions WHERE id = $1`, ids.chats.visibility)
		expect((await one(`SELECT name FROM sampling_configs WHERE id = $1`, mixed.sampling_config_id)).name).toBe("creative (2)")
	})

	test("KoboldCPP's model list and manager settings carry over", async () => {
		const models = await q(`SELECT * FROM local_models ORDER BY id`)
		expect(models.map((m) => m.filename)).toEqual(before.koboldcpp_models.map((m) => m.filename))
		expect(models.every((m) => m.kind === "text" && m.kind_source === "assumed")).toBe(true)
		const k = await one(`SELECT * FROM koboldcpp_settings`)
		expect(k.koboldcpp_managed_port).toBe(5011)
		expect(k.koboldcpp_managed_mode).toBe("managed")
	})
})

describe("configurations wired from the attic", () => {
	test("every 0.5.3 config a person wrote has its migrated pipeline config", async () => {
		const markers = (await q(`SELECT seed_key FROM pipeline_configs WHERE seed_key LIKE 'migrated:%'`)).map((r) => r.seed_key)
		for (const p of before.prompt_configs.filter((r) => !r.seed_key))
			expect(markers).toContain(`migrated:core:spec/chat-respond:${p.id}`)
		expect(markers.length).toBeGreaterThanOrEqual(
			before.prompt_configs.filter((r) => !r.seed_key).length +
				before.narrator_prompt_configs.filter((r) => !r.seed_key).length
		)
		// Prompt text only: a context config is an accepted loss, never a template.
		for (const c of before.context_configs.filter((r) => !r.seed_key)) {
			const t = await one(`SELECT count(*)::int AS n FROM pipeline_context_templates WHERE name = $1`, c.name)
			expect(t.n).toBe(0)
		}
	})

	test("a config's own connection and sampling picks are not carried — prompt text only", async () => {
		const valuesOf = async (seedKey: string) =>
			q(
				`SELECT v.node_key, v.slot, v.value FROM pipeline_config_values v JOIN pipeline_configs c ON c.id = v.config_id WHERE c.seed_key = $1`,
				seedKey
			)
		const mine = before.prompt_configs.find((p) => p.name === "My prompt")!
		expect(mine.connection_id).not.toBeNull()
		const respond = await valuesOf(`migrated:core:spec/chat-respond:${mine.id}`)
		expect(respond.map((v) => v.value)).not.toContainEqual(expect.objectContaining({ ref: mine.connection_id }))
		const dry = await one(`SELECT id FROM sampling_configs WHERE name = 'DRY + XTC'`)
		expect(respond.filter((v) => v.slot === "sampling").map((v) => v.value)).not.toContain(dry.id)
		const note = await one(
			`SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_label = 'connection and sampling picks on configs'`
		)
		expect(note.summary).toContain('"My prompt"')
	})

	test("a session selects its owner's active prompt config, never the chat's own (M5)", async () => {
		const sel = await one(
			`SELECT c.seed_key FROM pipeline_config_selections s JOIN pipeline_configs c ON c.id = s.config_id
			 JOIN pipeline_specs p ON p.id = s.spec_id
			 WHERE s.scope_kind = 'session' AND s.scope_id = $1 AND p.slug = 'core:spec/chat-respond'`,
			ids.chats.visibility
		)
		expect(sel.seed_key).toBe(`migrated:core:spec/chat-respond:${ids.legacyConfigs.prompt}`)
	})
})

describe("embeddings (D4)", () => {
	const identity = manifest.ids.embedding.configuredModel.m

	test("vectors from the configured model are kept, the rest dropped, counted per table", () => {
		const { kept, dropped } = run.restore!.embeddings
		const expectKept: Record<string, number> = {}
		const expectDropped: Record<string, number> = {}
		for (const e of manifest.detail.embeddingsByModel) {
			const tally = e.m === identity && e.d === 384 ? expectKept : expectDropped
			tally[e.t] = (tally[e.t] ?? 0) + e.n
		}
		expect(kept).toEqual(expectKept)
		expect(dropped).toEqual(expectDropped)
	})

	test("kept vectors are stamped with their text's hash, so only a row a repair rewrote re-embeds", async () => {
		for (const t of ["session_messages", "characters", "lorebook_bindings", "narrative_relationships"]) {
			const stale = await one(
				`SELECT count(*)::int AS n FROM ${t} WHERE embedding IS NOT NULL AND (embedding_source_hash IS NULL OR embedding_model <> $1)`,
				identity
			)
			expect(stale.n, t).toBe(0)
		}
		for (const t of ["session_messages", "characters", "lorebook_bindings"]) {
			const moved = await one(
				`SELECT count(*)::int AS n FROM ${t} WHERE embedding IS NOT NULL AND embedding_source_hash <> embed_text_hash`
			)
			expect(moved.n, t).toBe(0)
		}
		// Stamped against the text before the cast-tag repair: an entry it
		// rewrote reads stale (`upgrade.faithful` counts those); every other
		// one is fresh.
		const entries = await one(
			`SELECT count(*)::int AS n FROM lorebook_entry_vectors v JOIN lorebook_entries e ON e.id = v.entry_id
			 WHERE v.source_hash IS NULL OR v.model <> $1 OR v.dims <> 384
				OR (v.source_hash <> e.embed_text_hash AND e.content !~ '\{\{char:[0-9]+\}\}')`,
			identity
		)
		expect(entries.n).toBe(0)
		const kept = run.restore!.embeddings.kept
		expect(await count("lorebook_entry_vectors")).toBe(
			(kept.world_lore_entries ?? 0) + (kept.character_lore_entries ?? 0) + (kept.history_entries ?? 0)
		)
		expect(
			(await one(`SELECT count(*)::int AS n FROM session_messages WHERE embedding IS NOT NULL`)).n
		).toBe(kept.chat_messages)
		const { countUnembedded } = await import("$lib/server/embedding/vectorizationQueue")
		const pending = await countUnembedded(identity)
		const unvectored =
			(await one(`SELECT count(*)::int AS n FROM session_messages WHERE embedding IS NULL AND NOT is_generating AND btrim(content) <> ''`)).n
		expect(pending).toBeGreaterThanOrEqual(0)
		expect(unvectored).toBeGreaterThan(0)
	})
})

describe("upgrade notes (D6)", () => {
	test("each change an admin should know about is a logbook record, and admins are notified", async () => {
		const notes = await q(`SELECT object_id AS topic, summary FROM admin_logbook WHERE object_type = 'data-upgrade'`)
		const topics = new Set(notes.map((n) => n.topic))
		for (const t of [
			"summary",
			"history-date",
			"sampling-renamed",
			"connection-converted",
			"connection-merged",
			"connection-renamed",
			"prompt-format",
			"binding-merged",
			"cast-tag",
			"character-detail",
			"embeddings",
			"persona-uuid",
			"persona-default",
			"entry-priority",
			"accepted-loss"
		])
			expect(topics, t).toContain(t)
		expect(notes.filter((n) => n.topic === "history-date")).toHaveLength(
			4
		)
		expect(notes.filter((n) => n.topic === "sampling-renamed")).toHaveLength(2)
		const admins = before.users.filter((u) => u.is_admin).map((u) => u.id)
		const notified = await q(`SELECT user_id FROM notifications WHERE kind = 'core:notification/data-upgrade-done@1' ORDER BY user_id`)
		expect(notified.map((n) => n.user_id)).toEqual(admins)
	})
})
