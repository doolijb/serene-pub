/**
 * A session names no connection (ruled 2026-09-30, NOMENCLATURE §10).
 *
 * The pair a step runs on is the pipeline configuration's, or the instance
 * default. What a session tunes is its sampling and its prompts. Four claims:
 *
 *  1. A session-scope connection write is refused with a sentence — for an
 *     administrator too, since the matrix, not the 0.6 non-admin line, is what
 *     says no.
 *  2. A session-scope sampling write still lands.
 *  3. A stored session-scope connection row is culled by `reconcileConfigs`,
 *     leaving a notice on the configuration that session resolves, naming the
 *     step and the pair it held.
 *  4. A leftover row the cull has not reached yet is not what runs, and not
 *     what the panel shows.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { resolveConfigSources, SLOT_VALUE } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-connection-secret" }
})

const SECRET = "session-connection-secret"

let db: TestDb
let dataDir: string
let specId: number
let specVersionId: number
let sessionId: number
let adminId: number
let userId: number
let defaultConnectionId: number
let pickedConnectionId: number
let pickedModelId: number
let connectionDecl: { nodeKey: string; slot: string; path: string; typeLabel: string }
let samplingDecl: { nodeKey: string; slot: string; path: string }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-connection-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
	specId = spec.id
	specVersionId = spec.activeVersionId!

	const { declarations } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const decls = await declarations(db, specVersionId)
	const conn = decls.find((d) => d.matrixSlot === "connection")!
	connectionDecl = {
		nodeKey: conn.nodeKey,
		slot: conn.slot,
		path: conn.path,
		typeLabel: conn.typeLabel
	}
	const samp = decls.find(
		(d) => d.matrixSlot === "sampling" && d.nodeKey === conn.nodeKey
	)!
	samplingDecl = { nodeKey: samp.nodeKey, slot: samp.slot, path: samp.path }

	const [pubEndpoint] = await db
		.insert(schema.connections)
		.values({ name: "Pub endpoint", type: "ollama" })
		.returning()
	defaultConnectionId = pubEndpoint.id
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: defaultConnectionId
	})

	const [picked] = await db
		.insert(schema.connections)
		.values({ name: "Session's own endpoint", type: "ollama" })
		.returning()
	pickedConnectionId = picked.id
	const [model] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: pickedConnectionId,
			model: "llama3.1:8b",
			name: "Llama 8B"
		})
		.returning()
	pickedModelId = model.id

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "session-connection-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [user] = await db
		.insert(schema.users)
		.values({ username: "session-connection-user", isAdmin: false })
		.returning()
	userId = user.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const sessionRows = () =>
	db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, specId),
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId)
			)
		)

const leaveSessionConnection = () =>
	db.insert(schema.pipelineNodeOverrides).values({
		specId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: connectionDecl.nodeKey,
		slot: connectionDecl.slot,
		path: connectionDecl.path,
		value: { ref: pickedConnectionId, modelId: pickedModelId }
	})

describe("writing a connection at session scope", () => {
	it("is refused with a sentence, for an administrator too", async () => {
		const { writeOption, optionId, OptionNotWritableError } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const id = optionId(
			SECRET,
			connectionDecl.nodeKey,
			connectionDecl.slot,
			connectionDecl.path
		)
		const write = writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			{ userId: adminId, isAdmin: true, sessionId },
			id,
			{ ref: pickedConnectionId, modelId: pickedModelId }
		)
		await expect(write).rejects.toBeInstanceOf(OptionNotWritableError)
		await expect(write).rejects.toThrow(
			/A session never picks its own connection/
		)
		expect(
			(await sessionRows()).filter((r) => r.slot === connectionDecl.slot)
		).toEqual([])
	})

	it("while sampling at session scope still lands", async () => {
		const { writeOption, optionId } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const [sampling] = await db
			.insert(schema.samplingConfigs)
			.values({ name: "Session sampling", values: {} })
			.returning()
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			{ userId: adminId, isAdmin: true, sessionId },
			optionId(
				SECRET,
				samplingDecl.nodeKey,
				samplingDecl.slot,
				samplingDecl.path
			),
			sampling.id
		)
		const row = (await sessionRows()).find(
			(r) => r.slot === samplingDecl.slot
		)
		expect(row?.value).toBe(sampling.id)
	})
})

describe("a leftover session connection row", () => {
	it("is not what runs", async () => {
		await leaveSessionConnection()
		const { buildWorld } = await import(
			"$lib/server/pipelines/config/world"
		)
		const world = await buildWorld(db, {
			sessionId,
			specId: CHAT_RESPOND_SPEC_ID
		})
		const sourced: any = resolveConfigSources(world as any, [
			connectionDecl.nodeKey
		])
		const at = sourced?.[connectionDecl.nodeKey]?.connection?.[SLOT_VALUE]
		expect(at?.scopeKind).not.toBe("session")
		expect(String(at?.value?.id ?? at?.value)).toBe(
			String(defaultConnectionId)
		)
	})

	it("is not what the panel shows, and the row names what does run", async () => {
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		const view: any = await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: adminId,
			isAdmin: true,
			sessionId
		})
		const options: any[] = groupOptions(view.groups)
		const conn = options.find((o: any) => o.control === "connection-ref")
		expect(conn, "connection row visible to an administrator").toBeTruthy()
		expect(conn.writable).toBe(false)
		expect(conn.source).not.toBe("session")
		expect(conn.valueLabel).toBe("Pub endpoint")
	})

	it("is not shown to someone who is not an administrator, by name or otherwise", async () => {
		// A row is sent to a role that can normally edit it (owner ruling
		// 2026-09-30); a non-admin never edits a connection.
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		const view: any = await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId,
			isAdmin: false,
			sessionId
		})
		const options: any[] = groupOptions(view.groups)
		expect(options.length).toBeGreaterThan(0)
		expect(options.filter((o: any) => o.control === "connection-ref")).toEqual([])
	})

	it("is culled at reconcile, leaving a notice naming the step and the pair", async () => {
		const { reconcileConfigs, resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		await reconcileConfigs(db, specId, specVersionId, CHAT_RESPOND_SPEC_ID)

		const left = await sessionRows()
		expect(left.filter((r) => r.slot === connectionDecl.slot)).toEqual([])
		// Sampling is the session's own and stays.
		expect(left.some((r) => r.slot === samplingDecl.slot)).toBe(true)

		const selected = await resolveSelectedConfig(
			db,
			specId,
			CHAT_RESPOND_SPEC_ID,
			{ sessionId }
		)
		const notices = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(
				and(
					eq(schema.pipelineConfigNotices.configId, selected!.configId),
					eq(schema.pipelineConfigNotices.nodeKey, connectionDecl.nodeKey),
					eq(schema.pipelineConfigNotices.slot, connectionDecl.slot)
				)
			)
		expect(notices).toHaveLength(1)
		expect(notices[0].kind).toBe("culled")
		expect(notices[0].label).toContain(`session ${sessionId}`)
		expect(notices[0].label).toContain(connectionDecl.typeLabel)
		expect(notices[0].label).toContain("Session's own endpoint · Llama 8B")
		expect(notices[0].previousValue).toEqual({
			ref: pickedConnectionId,
			modelId: pickedModelId
		})

		// Idempotent: a second boot finds nothing and says nothing more.
		await reconcileConfigs(db, specId, specVersionId, CHAT_RESPOND_SPEC_ID)
		const again = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(
				and(
					eq(schema.pipelineConfigNotices.configId, selected!.configId),
					eq(schema.pipelineConfigNotices.slot, connectionDecl.slot)
				)
			)
		expect(again).toHaveLength(1)
	})
})
