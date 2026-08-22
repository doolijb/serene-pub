/**
 * What a person edits in the pipeline panel is what the run uses.
 *
 * This is the seam that decides whether the whole configuration layer is real.
 * Everything else can be correct — the panel, the configs, the prompts, the
 * migration — and if the run still resolves against the legacy projection alone
 * then every screen agrees with the user and the model does something else. It
 * is the worst class of bug in this area, because there is nothing to see.
 *
 * The three layers are checked separately because they arrive by different
 * routes and can each be wired wrongly on their own:
 *
 *  1. a **selected config**, which lands at `preset`;
 *  2. a **single override**, at the scope it was written at, over the config;
 *  3. a **prompt reference**, which is stored as an id and has to become words.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { RESPOND_SPEC_ID } from "./specs"

let db: TestDb
let dataDir: string
let userId: number
let chatId: number
let specId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "world-layer-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-world-layer-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "world-layer-user", isAdmin: false })
		.returning()
	userId = user.id
	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	chatId = chat.id

	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db as any)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const worldFor = async () => {
	const { buildWorld } = await import("./world")
	return await buildWorld(db as any, {
		chatId,
		userId,
		specId: RESPOND_SPEC_ID
	})
}

const resolvedAt = async (nodeKey: string, slot: string, path: string) => {
	const world = await worldFor()
	const sourced = resolveConfigSources(world as any, [nodeKey])
	return sourced[nodeKey]?.[slot]?.[path]
}

describe("the shipped configuration reaches a run", () => {
	it("puts the selected config's prompt text where the node reads it", async () => {
		// The prompt is stored as an *id* on the config and the node needs the
		// words. If the dereference is missing the node renders a blank, which
		// reads as the model ignoring an instruction.
		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved).toBeTruthy()
		expect(typeof resolved!.value).toBe("string")
		expect(String(resolved!.value).length).toBeGreaterThan(0)
	})

	it("falls back to the namespace's own default when nothing else selects a prompt", async () => {
		// The floor. Every layer above it is optional — a config need not
		// carry a prompts value, and clearing an override deletes a row
		// rather than writing one — so without this a run could go out with
		// empty instructions, which reads as the model ignoring its
		// character sheet rather than as "no prompt is selected".
		await db
			.delete(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.slot, "prompts"))
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.slot, "prompts"))

		// The legacy projection also lands at `defaults` and — because the
		// pipeline's prompts were seeded *from* those very rows — carries
		// identical text. Left in place, this test would pass on the legacy
		// path and prove nothing about the floor, so the legacy pointers are
		// cleared: what remains is an instance with no prompt selected
		// anywhere, which is the case the floor exists for.
		await db
			.update(schema.systemSettings)
			.set({ defaultPromptConfigId: null })
		await db.update(schema.userSettings).set({ activePromptConfigId: null })
		await db.update(schema.chats).set({ promptConfigId: null })

		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved).toBeTruthy()
		expect(String(resolved!.value).length).toBeGreaterThan(0)

		// It is the pipeline's own shipped prompt — the first it ships with —
		// and it sits at `defaults`, under anything anyone actually chose.
		const { defaultPromptFor } = await import("./seedPrompts")
		const id = await defaultPromptFor(db as any, specId)
		const { resolvePromptFields } = await import("./prompts")
		const fields = await resolvePromptFields(db as any, id!)
		expect(resolved!.value).toBe(fields.systemPrompt)
		expect(resolved!.scopeKind).toBe("defaults")
	})
})

describe("a value someone set wins", () => {
	it("lets a user override beat the selected config", async () => {
		const [node] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.nodeKey, "rank"))
			.limit(1)
		expect(node).toBeTruthy()

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "user",
			scopeId: userId,
			nodeKey: "rank",
			slot: "params",
			path: "budget",
			value: 1234
		})

		const resolved = await resolvedAt("rank", "params", "budget")
		expect(resolved!.value).toBe(1234)
		expect(resolved!.scopeKind).toBe("user")
	})

	it("lets a chat-scoped value beat the user's own", async () => {
		// The chain is the point. A per-chat tweak has to win in that chat and
		// nowhere else, or "this chat only" means nothing.
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "chat",
			scopeId: chatId,
			nodeKey: "rank",
			slot: "params",
			path: "budget",
			value: 4321
		})

		const resolved = await resolvedAt("rank", "params", "budget")
		expect(resolved!.value).toBe(4321)
		expect(resolved!.scopeKind).toBe("chat")
	})

	it("keeps another user's override out of this world", async () => {
		const [other] = await db
			.insert(schema.users)
			.values({ username: "world-layer-other", isAdmin: false })
			.returning()

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "user",
			scopeId: other.id,
			nodeKey: "rank",
			slot: "params",
			path: "minInclude",
			value: 999
		})

		const resolved = await resolvedAt("rank", "params", "minInclude")
		// Either unset, or set by something that is not that user.
		expect(resolved?.value).not.toBe(999)
	})
})

describe("a prompt edited in the panel", () => {
	it("reaches the node as text, not as a row id", async () => {
		// The failure this catches is specific and silent: a config stores the
		// reference, so a world that forwarded it unchanged would hand the node
		// the number 7 where its system prompt should be.
		const [prompt] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId,
				name: "Panel-edited prompt",
				fields: {
					systemPrompt: "SPEAK ONLY IN RIDDLES",
					system: "SPEAK ONLY IN RIDDLES"
				}
			})
			.returning()

		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Riddles", isImmutable: false })
			.returning()

		const decls = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config.id))
		expect(decls).toHaveLength(0)

		await db.insert(schema.pipelineConfigValues).values({
			configId: config.id,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: prompt.id
		})

		const { selectConfig } = await import("./configs")
		await selectConfig(db as any, specId, "user", userId, config.id, userId)

		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved!.value).toBe("SPEAK ONLY IN RIDDLES")
		// A whole named configuration sits at `preset` in the chain (12 §2):
		// under an individual override, over the instance default.
		expect(resolved!.scopeKind).toBe("preset")
	})

	it("reaches the node as text when picked as an override, too", async () => {
		// The panel's writeOption stores a prompts-ref the same way a config
		// value does — `(slot: "prompts", path: "", value: <row id>)` — but in
		// `pipeline_node_overrides`. That row travels a different loop in
		// `applyPipelineLayer`, so it can be broken while the config path is
		// green: the node gets a number where its system prompt should be.
		const [prompt] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId,
				name: "Override-picked prompt",
				fields: {
					systemPrompt: "ANSWER ONLY IN HAIKU",
					system: "ANSWER ONLY IN HAIKU"
				}
			})
			.returning()

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "chat",
			scopeId: chatId,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: prompt.id
		})

		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved!.value).toBe("ANSWER ONLY IN HAIKU")
		// At the scope it was written at — over the selected config's preset
		// layer, so a per-chat pick beats the named config in that chat.
		expect(resolved!.scopeKind).toBe("chat")
	})
})
