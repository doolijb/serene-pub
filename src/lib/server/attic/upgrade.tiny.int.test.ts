/**
 * The 0.5.3 → 0.6 upgrade over the tiny fixture (one user, one chat), booted
 * with the dev-mode `meta.json` (`version: "0.0.0"`): a 0.5.3 install that
 * was only ever run under `vite dev` upgrades the same way.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import {
	bootFixture,
	fixtureManifest,
	placeFixture,
	previewTurn,
	runUpgradeTasks,
	type PreviewOutcome
} from "./testFixture"
import { ATTIC_SCHEMA, atticExists } from "./index"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { readJournalMigrations } from "$lib/server/db/migrationLedgerRepair"

/** Two ledger rows of the kind 0.5.x's old and dev chains left behind. */
const STRAY = ["a".repeat(64), "b".repeat(64)]

const manifest = fixtureManifest("tiny")
let db: Db
let run: Awaited<ReturnType<typeof runUpgradeTasks>>
let preview: PreviewOutcome
const A = `"${ATTIC_SCHEMA}"`

const rows = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
	rawRows<T>(await db.execute(q))
const count = async (table: string) =>
	Number((await rows<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table}`)))[0].n)

beforeAll(async () => {
	const { dataDir } = placeFixture("tiny", { meta: "meta.dev.json" })
	// Before the boot opens it: the ledger a 0.5.x install that once ran
	// another build carries.
	const pre = new PGlite(path.join(dataDir, "serene-pub.db"))
	await pre.waitReady
	for (const [i, hash] of STRAY.entries())
		await pre.query(
			`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
			[hash, 1_700_000_000_000 + i]
		)
	await pre.close()
	db = await bootFixture()
	expect(await atticExists(db)).toBe(true)
	// The one person picks a shipped prompt that is not 0.6's default — the
	// seed 0.6 renamed (E4.1) — and has a sampling config whose values sit
	// outside 0.6's declared ranges.
	await db.execute(
		sql.raw(`UPDATE ${A}.user_settings SET active_prompt_config_id =
			(SELECT id FROM ${A}.prompt_configs WHERE seed_key = 'prompt-neutral-chat')`)
	)
	const clamped = await rows<{ id: number }>(
		sql.raw(`UPDATE ${A}.sampling_configs SET temperature = 3.5, top_k = 500
			WHERE seed_key IS NULL RETURNING id`)
	)
	expect(clamped.length).toBeGreaterThan(0)
	await addLegacyConnections()
	run = await runUpgradeTasks(db)
	preview = await previewTurn(db, manifest.ids.chats.solo)
}, 300_000)

/**
 * The shape of a real 0.5.3 pub's connections (the owner's, 2026-10-03): one
 * row per model, so ten Ollama rows at one host spelled three ways, named
 * after their models or "Test"; KoboldCPP rows at a port nothing listens on;
 * LM Studio rows at `localhost` and at `127.0.0.1`; a llama.cpp row; and a
 * second row to the fixture's own OpenAI-compatible service with the SAME key
 * (encrypted again, so the envelopes differ) next to one with another key.
 * The pub's default connection is that second row.
 */
const LEGACY = {
	twin: 2,
	otherKey: 3,
	ollama: Array.from({ length: 10 }, (_, i) => 10 + i),
	kobold: [20, 21, 22],
	lmstudio: [30, 31, 32],
	llamacpp: 40
}
async function addLegacyConnections(): Promise<void> {
	const { decryptApiKeyField, encryptApiKeyField } = await import("$lib/server/utils/tokenCrypto")
	const [fixture] = await rows<{ extra_json: Record<string, any>; base_url: string }>(
		sql.raw(`SELECT extra_json, base_url FROM ${A}.connections WHERE id = 1`)
	)
	const key = decryptApiKeyField(fixture.extra_json.apiKey)!
	expect(key.length).toBeGreaterThan(0)
	const values: unknown[][] = [
		[LEGACY.twin, "Tiny twin", "openai", `${fixture.base_url}/`, "gate-model-2",
			{ stream: true, prerenderPrompt: false, apiKey: encryptApiKeyField(key) }, "openai-gpt4o", "chatml"],
		[LEGACY.otherKey, "Other key", "openai", fixture.base_url, "gate-model",
			{ stream: true, apiKey: encryptApiKeyField(`${key}-other`) }, "openai-gpt4o", "chatml"],
		...LEGACY.ollama.map((id, i) => [
			id,
			i % 4 === 0 ? (i === 0 ? "Test" : "TESTTTT") : `M${i % 7}-12B-GGUF:Q4_K_M`,
			"ollama",
			["http://localhost:11434", "http://localhost:11434/", "HTTP://LOCALHOST:11434/"][i % 3],
			// Rows 0 and 7 name the same model.
			`hf.co/x/M${i % 7}-12B-GGUF:Q4_K_M`,
			{ stream: true, think: i === 1, keepAlive: "300ms", useChat: true },
			"estimate",
			"vicuna"
		]),
		[LEGACY.kobold[0], "Test", "koboldcpp", "http://localhost:5001", "koboldcpp/a", { stream: true }, "estimate", null],
		[LEGACY.kobold[1], "inactive", "koboldcpp", "http://localhost:5001/", "koboldcpp/b", { stream: true }, "estimate", null],
		[LEGACY.kobold[2], "Skyfall-31B-v4y-Q4_K_M", "koboldcpp", "http://localhost:5009", "koboldcpp/c", { stream: true }, "estimate", null],
		[LEGACY.lmstudio[0], "Test", "lmstudio", "ws://localhost:1234", "qwen-a", { stream: true }, "estimate", "vicuna"],
		[LEGACY.lmstudio[1], "Testt", "lmstudio", "ws://localhost:1234", "qwen-b", { stream: true }, "estimate", "vicuna"],
		[LEGACY.lmstudio[2], "0.3.1 Test", "lmstudio", "http://127.0.0.1:1234", "qwen-c", { stream: true }, "estimate", "vicuna"],
		[LEGACY.llamacpp, "LLama test", "llamacpp_completion", "http://127.0.0.1:8080", "local.gguf", { stream: true }, "estimate", null]
	]
	for (const v of values)
		await (db as any).$client.query(
			`INSERT INTO ${A}.connections (id, name, type, base_url, model, extra_json, token_counter, prompt_format)
			 VALUES ($1, $2, $3, $4, $5, $6::json, $7, $8)`,
			[v[0], v[1], v[2], v[3], v[4], JSON.stringify(v[5]), v[6], v[7]]
		)
	await db.execute(sql.raw(`UPDATE ${A}.system_settings SET default_connection_id = ${LEGACY.twin}`))
	await db.execute(
		sql.raw(`UPDATE ${A}."__manifest" SET row_count = (SELECT count(*) FROM ${A}.connections)
			WHERE table_name = 'connections'`)
	)
}

describe("tiny 0.5.3 fixture, dev-mode meta", () => {
	test("the restore reconciles every table and the wiring drops the attic", () => {
		expect(run.restore?.alreadyRestored).toBe(false)
		expect(
			run.restore!.reconciliation.filter((l) => l.expected !== l.actual)
		).toEqual([])
		expect(run.wiring).not.toBeNull()
	})

	test("the attic is gone", async () => {
		expect(await atticExists(db)).toBe(false)
		const r = await rows<{ n: number }>(
			sql`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = ${ATTIC_SCHEMA}`
		)
		expect(r[0].n).toBe(0)
	})

	test("the chat is a Chat session with its messages, under the same ids", async () => {
		expect(await count("sessions")).toBe(manifest.counts.chats)
		expect(await count("session_messages")).toBe(manifest.counts.chat_messages)
		const s = await rows<{ genre_id: string }>(sql`SELECT genre_id FROM sessions WHERE id = ${manifest.ids.chats.solo}`)
		expect(s[0].genre_id).toBe("core:genre/chat")
		expect(await count("messages")).toBe(manifest.counts.chat_messages)
	})

	test("the reply left generating is settled", async () => {
		const g = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM session_messages WHERE is_generating`)
		expect(g[0].n).toBe(0)
	})

	test("the session compiles its prompt on the first boot", () => {
		expect(preview.halt, preview.reason ?? "").toBe("generate")
	})

	test("on a single-user install the person's picks are the instance's — a shipped pick by its renamed seed (B1, M1)", async () => {
		const sel = await rows<{ seed_key: string; name: string; config_id: number }>(sql`
			SELECT c.seed_key, c.name, c.id AS config_id FROM pipeline_config_selections s
			JOIN pipeline_configs c ON c.id = s.config_id JOIN pipeline_specs p ON p.id = s.spec_id
			WHERE p.slug = 'core:spec/respond' AND s.scope_kind = 'pub'`)
		expect(sel).toHaveLength(1)
		expect(sel[0].name).toBe("Neutral - Session")
		const prompts = await rows<{ seed_key: string }>(sql`
			SELECT p.seed_key FROM pipeline_config_values v JOIN pipeline_prompts p ON p.id = (v.value::text)::int
			WHERE v.config_id = ${sel[0].config_id} AND v.slot = 'prompts'`)
		expect(prompts.map((p) => p.seed_key)).toContain(
			"pipeline-prompt:core:task/build-template-context:prompts:prompt-neutral-session"
		)
		expect(preview.text).toContain("next reply in a fictional session between")
		const session = await rows<{ n: number }>(sql`
			SELECT count(*)::int AS n FROM pipeline_config_selections WHERE scope_kind = 'session'`)
		expect(session[0].n).toBe(0)
	})

	test("sampling values outside 0.6's ranges are clamped, and a note says which", async () => {
		const notes = await rows<{ summary: string }>(sql`
			SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'sampling-clamped'`)
		expect(notes.length).toBeGreaterThan(0)
		expect(notes.map((n) => n.summary).join(" ")).toMatch(/temperature/)
		expect(notes.map((n) => n.summary).join(" ")).toMatch(/topK/)
		const live = await rows<{ values: any }>(sql`SELECT values FROM sampling_configs WHERE seed_key IS NULL`)
		for (const r of live) {
			expect(r.values.temperature).toBe(2)
			expect(r.values.topK).toBe(200)
		}
	})

	test("the summary note, the notification and History count the same notes — every one", async () => {
		const inHistory = await count(`admin_logbook WHERE object_type = 'data-upgrade'`)
		const [summary] = await rows<{ summary: string }>(sql`
			SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'summary'`)
		const said = Number(/with (\d+) note/.exec(summary?.summary ?? "")?.[1])
		const notified = await rows<{ vars: { notes: number } }>(sql`
			SELECT vars FROM notifications WHERE kind = 'core:notification/data-upgrade-done@1'`)
		expect(notified.length).toBeGreaterThan(0)
		expect({ said, notified: notified[0].vars.notes }).toEqual({
			said: inHistory,
			notified: inHistory
		})
	})

	test("the ledger rows no shipped migration matches are pruned, and a note says how many", async () => {
		const shipped = new Set(
			readJournalMigrations(path.resolve(process.cwd(), "drizzle")).map((m) => m.hash)
		)
		const ledger = await rows<{ hash: string }>(sql`SELECT hash FROM drizzle.__drizzle_migrations`)
		expect(ledger.filter((r) => !shipped.has(r.hash))).toEqual([])
		const notes = await rows<{ summary: string; object_label: string }>(sql`
			SELECT summary, object_label FROM admin_logbook
			WHERE object_type = 'data-upgrade' AND object_id = 'migration-ledger'`)
		expect(notes).toHaveLength(1)
		expect(notes[0].object_label).toBe("Migration record")
		expect(notes[0].summary).toMatch(/This pub's migration record held 2 leftover entries/)
	})

	test("connections to one service are one connection, named for the service, a model each", async () => {
		const conns = await rows<{ id: number; name: string; type: string; preset: string | null }>(
			sql`SELECT id, name, type, preset FROM connections ORDER BY id`
		)
		expect(conns.map((c) => [c.id, c.name, c.type])).toEqual([
			[1, "Custom (OpenAI-Compatible)", "openai"],
			[LEGACY.otherKey, "Custom (OpenAI-Compatible) 2", "openai"],
			[LEGACY.ollama[0], "Ollama", "ollama"],
			[LEGACY.kobold[0], "KoboldCPP", "koboldcpp"],
			[LEGACY.kobold[2], "KoboldCPP 2", "koboldcpp"],
			[LEGACY.lmstudio[0], "LM Studio", "lmstudio"],
			[LEGACY.lmstudio[2], "LM Studio 2", "lmstudio"],
			[LEGACY.llamacpp, "Llama.cpp", "llamacpp"]
		])
		const models = async (id: number) =>
			(
				await rows<{ model: string }>(
					sql`SELECT model FROM connection_models WHERE connection_id = ${id} ORDER BY id`
				)
			).map((m) => m.model)
		expect(await models(1)).toEqual(["gate-model", "gate-model-2"])
		expect(await models(LEGACY.ollama[0])).toHaveLength(7)
		expect(await models(LEGACY.kobold[0])).toEqual(["koboldcpp/a", "koboldcpp/b"])
		expect(await models(LEGACY.lmstudio[0])).toEqual(["qwen-a", "qwen-b"])
		expect(await count("connection_models")).toBe(17)
	})

	test("the default connection is the pair its model became; a differing option rides on the model", async () => {
		const [d] = await rows<{ connection_id: number; model: string }>(sql`
			SELECT d.connection_id, m.model FROM connection_defaults d
			JOIN connection_models m ON m.id = d.connection_model_id
			WHERE d.input = 'text' AND d.output = 'text'`)
		expect(d).toEqual({ connection_id: 1, model: "gate-model-2" })
		const [thinking] = await rows<{ extra_json: Record<string, unknown> }>(sql`
			SELECT extra_json FROM connection_models WHERE model = 'hf.co/x/M1-12B-GGUF:Q4_K_M'`)
		expect(thinking.extra_json).toEqual({ think: true })
		const [ollama] = await rows<{ extra_json: Record<string, unknown> }>(sql`
			SELECT extra_json FROM connections WHERE id = ${LEGACY.ollama[0]}`)
		expect(ollama.extra_json).toMatchObject({ think: false, keepAlive: "5m" })
	})

	test("each combined or renamed connection is said once, with its 0.5.3 names", async () => {
		const notes = await rows<{ topic: string; object_label: string; summary: string }>(sql`
			SELECT object_id AS topic, object_label, summary FROM admin_logbook
			WHERE object_type = 'data-upgrade' AND object_id IN ('connection-merged', 'connection-renamed')`)
		notes.sort((a, b) => (a.object_label < b.object_label ? -1 : 1))
		expect(notes.map((n) => [n.topic, n.object_label])).toEqual([
			["connection-merged", "Custom (OpenAI-Compatible)"],
			["connection-renamed", "Custom (OpenAI-Compatible) 2"],
			["connection-merged", "KoboldCPP"],
			["connection-renamed", "KoboldCPP 2"],
			["connection-merged", "LM Studio"],
			["connection-renamed", "LM Studio 2"],
			["connection-renamed", "Llama.cpp"],
			["connection-merged", "Ollama"]
		])
		const ollama = notes.find((n) => n.object_label === "Ollama")!.summary
		expect(ollama).toMatch(/^10 connections to Ollama at http:\/\/localhost:11434 were combined into one connection, "Ollama", with 7 models: /)
		expect(ollama).toContain('"Test"')
		expect(ollama).toContain('"TESTTTT"')
		// Two rows named one model with different thinking: the first one's kept.
		expect(ollama).toContain(
			'"M1-12B-GGUF:Q4_K_M" and "TESTTTT" both named hf.co/x/M1-12B-GGUF:Q4_K_M with different settings'
		)
		const openai = notes.find((n) => n.object_label === "Custom (OpenAI-Compatible)")!.summary
		expect(openai).toContain("with the same API key")
		expect(notes.find((n) => n.object_label === "Custom (OpenAI-Compatible) 2")!.summary).toContain(
			'the same address as "Custom (OpenAI-Compatible)" with a different API key'
		)
	})

	test("a second boot is a no-op", async () => {
		const before = await count("session_messages")
		const again = await runUpgradeTasks(db)
		expect(again.restore).toBeNull()
		expect(again.wiring).toBeNull()
		expect(await count("session_messages")).toBe(before)
		expect(await count("characters")).toBe(
			manifest.counts.characters + manifest.counts.personas
		)
	}, 120_000)
})
