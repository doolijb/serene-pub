/**
 * 0098: the old wire-mode flags' INTENT survives becoming a capability.
 *
 * Every one of `extra_json.useChat`, `extra_json.prerenderPrompt` and
 * Anthropic's unconditional true defaulted to chat, so a connection that never
 * touched them is unaffected by the change. The one that DID touch them is what
 * this file is about: somebody who switched Use Chat Mode off, or Prerender
 * Prompt on, chose text completion deliberately, and dropping the flag without
 * moving that choice would silently flip them to the other method — on the send
 * path, with nothing reporting it. Which is the same shape as the defect wire
 * mode exists to fix, pointed the other way.
 *
 * ⚠ It runs against the REAL migration, applied by `createTestDb` the way a real
 * upgrade applies it. A test that hand-wrote the override would prove the
 * resolver reads it and nothing about whether anybody's row ever gets one.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { resolveWireMode } from "$lib/server/connections/resolve"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

/**
 * Rows inserted BEFORE the migration, then migrated — which is the only order
 * that tests anything.
 *
 * `createTestDb` applies every migration on creation, so a row inserted
 * afterwards would never meet 0098. The file therefore builds the database,
 * writes the pre-upgrade rows, and replays that one migration's statement over
 * them: the same SQL, from the same file, against the same shapes.
 */
const MIGRATION = "drizzle/0098_wire_mode_intent.sql"

let migrationSql: string

beforeAll(async () => {
	db = await createTestDb()
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	migrationSql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
}, 60_000)

/** Insert a pre-upgrade row, then run 0098 over the table. */
async function migrated(
	type: string,
	extraJson: Record<string, unknown>,
	capabilities: Record<string, unknown> = {}
) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${type} ${JSON.stringify(extraJson)}`,
			type,
			baseUrl: "http://localhost",
			extraJson,
			capabilities
		})
		.returning()
	await db.execute(sql.raw(migrationSql))
	const [after] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, row.id))
		.limit(1)
	return after
}

describe("a deliberate text-completion choice survives the change", () => {
	it("turns KoboldCPP's useChat:false into a hand-set override", async () => {
		const row = await migrated(CONNECTION_TYPE.KOBOLDCPP, {
			useChat: false,
			stream: false
		})
		// ⚠ `wire_chat: false`, not `wire_completion: true`. The tie-break
		// prefers chat whenever both are available, so switching completion on
		// would leave chat on too and change nothing.
		expect((row.capabilities as any).overrides).toEqual({
			wire_chat: false
		})
		expect(resolveWireMode(row as any)).toBe("completion")
	}, 60_000)

	it("reads a 0.5.x row as it was written: useChat:false stays in completion mode", async () => {
		// The exact `extra_json` 0.5.3's KoboldCppForm wrote. `useChat` is the
		// stored key, chat-completions wire vocabulary; the 2026-08-24 session
		// rename respelled it `useSession` with no data migration, and a 0098
		// reading that spelling left every 0.5.x text-completion KoboldCPP
		// connection to land on chat after the upgrade. No alias is read: the
		// key is `useChat`, in 0.5.x and now.
		const row = await migrated(CONNECTION_TYPE.KOBOLDCPP, {
			stream: true,
			useChat: false,
			useMemory: false,
			memory: "",
			trimStop: true,
			renderSpecial: false,
			bypassEos: false,
			grammarRetainState: false,
			logprobs: false,
			replaceInstructPlaceholders: false,
			enableThinking: null
		})
		expect((row.capabilities as any).overrides).toEqual({
			wire_chat: false
		})
		expect(resolveWireMode(row as any)).toBe("completion")

		// LM Studio's 0.5.3 form wrote the same key alongside its own.
		const lmStudio = await migrated(CONNECTION_TYPE.LM_STUDIO, {
			stream: true,
			think: false,
			ttl: 60,
			raw: true,
			useChat: false
		})
		expect(resolveWireMode(lmStudio as any)).toBe("completion")
	}, 60_000)

	it("turns the OpenAI adapter's prerenderPrompt:true into the same override", async () => {
		const row = await migrated(CONNECTION_TYPE.OPENAI, {
			prerenderPrompt: true,
			apiKey: ""
		})
		expect((row.capabilities as any).overrides).toEqual({
			wire_chat: false
		})
		expect(resolveWireMode(row as any)).toBe("completion")
	}, 60_000)

	it("keeps the overrides a person already had", async () => {
		// The durable half of the column is shared: somebody may have switched
		// vision off by hand, and replacing `overrides` wholesale would silently
		// undo it.
		const row = await migrated(
			CONNECTION_TYPE.KOBOLDCPP,
			{ useChat: false },
			{
				overrides: { "text+image->text": false },
				probe: {
					found: { "text->text": 1 },
					at: "2026-01-01T00:00:00Z"
				}
			}
		)
		expect((row.capabilities as any).overrides).toEqual({
			"text+image->text": false,
			wire_chat: false
		})
		// And the probe — the OTHER durable half — is untouched.
		expect((row.capabilities as any).probe?.at).toBe("2026-01-01T00:00:00Z")
	}, 60_000)
})

describe("what it deliberately leaves alone", () => {
	it("does not touch a connection that was in chat mode", async () => {
		// Chat is what every one of those flags defaulted to and what the
		// tie-break picks, so an explicit `true` needs no override at all —
		// writing one would pin a value that is currently free to follow a
		// preset or a probe.
		const row = await migrated(CONNECTION_TYPE.KOBOLDCPP, {
			useChat: true
		})
		expect(row.capabilities).toEqual({})
		expect(resolveWireMode(row as any)).toBe("chat")
	}, 60_000)

	it("does not read an ABSENT useChat as a choice", async () => {
		// `OllamaAdapter` read the same setting with two different defaults in
		// one file and its own comment calls that a bug. Absence there is an
		// accident, not intent, and encoding it would make the bug durable.
		const row = await migrated(CONNECTION_TYPE.OLLAMA, { stream: false })
		expect(row.capabilities).toEqual({})
		expect(resolveWireMode(row as any)).toBe("chat")
	}, 60_000)

	it('does not read the STRING "false" as the boolean flag', async () => {
		// ⚠ The mutation that `->>` would pass and `->` catches. `extra_json` is
		// an untyped column the connection form spreads verbatim, and the old
		// read was `extraJson?.useChat ?? true` — which takes a non-empty
		// string as TRUTHY. So a row carrying `"false"` was in chat mode, and a
		// text-level match would have flipped it to completion while claiming to
		// preserve intent.
		const row = await migrated(CONNECTION_TYPE.KOBOLDCPP, {
			useChat: "false"
		})
		expect(row.capabilities).toEqual({})
		expect(resolveWireMode(row as any)).toBe("chat")
	}, 60_000)
})
