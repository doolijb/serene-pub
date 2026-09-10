/**
 * `pipelines:artifactRuns` — which runs produced this row.
 *
 * `pipeline_run_artifacts` has recorded what every run made since the relation
 * replaced the nullable column, and until this handler existed only one
 * direction of it was readable from a client: a message could ask for its own
 * run. An image could not, so a picture a pipeline generated and a picture
 * dragged in off the desktop looked identical in the gallery — the run was
 * written down and then unreachable from the one place a person looks at the
 * thing it made.
 *
 * What is pinned here is the gate, because the gate is the part that would be
 * wrong in a way nobody notices:
 *
 * 1. **Gated on the artifact, never on the run.** A run row carries a
 *    `user_id`, and scoping to it would be the easy check and the wrong one —
 *    it answers "did you make this run" rather than "may you see this row".
 *    A file is gated the way every `media:*` by-id handler gates one; a message
 *    is gated on its session, so a guest reading a reply addressed to them can
 *    see what made it.
 * 2. **A refusal says what a missing row says**, so a caller who cannot reach
 *    the artifact learns nothing about whether a run exists for it.
 * 3. **Every run, labelled** — a regenerated image legitimately has more than
 *    one, and a preview is a weaker record than a send rather than one to hide.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "artifact-runs-int-secret"
	}
})

let ownerId: number
let guestId: number
let strangerId: number
let sessionId: number
let messageId: number
/** The image a run made — the subject of most of the tests below. */
let madeFileId: number
/** An image with no run behind it: uploaded, not generated. */
let uploadedFileId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)

	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: "artifact-runs-owner", isAdmin: true })
		.returning()
	ownerId = owner.id
	const [guest] = await testDb
		.insert(schema.users)
		.values({ username: "artifact-runs-guest", isAdmin: false })
		.returning()
	guestId = guest.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "artifact-runs-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Artifact runs session",
			isGroup: false,
			userId: ownerId
		} as any)
		.returning()
	sessionId = session.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guestId })

	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			content: "The gate holds."
		})
		.returning()
	messageId = message.id

	const [made] = await testDb
		.insert(schema.files)
		.values({
			userId: ownerId,
			kind: "image",
			hash: "artifact-runs-made"
		} as any)
		.returning()
	madeFileId = made.id
	const [uploaded] = await testDb
		.insert(schema.files)
		.values({
			userId: ownerId,
			kind: "image",
			hash: "artifact-runs-uploaded"
		} as any)
		.returning()
	uploadedFileId = uploaded.id

	const run = async (over: Record<string, any>) => {
		const [row] = await testDb
			.insert(schema.pipelineRuns)
			.values({
				specVersion: "1.0.0",
				userId: ownerId,
				sessionId,
				outcome: "ok",
				triggerSource: "event",
				seed: "s",
				startedAt: new Date(0),
				endedAt: new Date(1000),
				elapsedMs: 1000,
				tokensSpent: 4,
				receipt: { outcome: "ok", nodes: [] },
				...over
			} as any)
			.returning()
		return row
	}

	// The send: one run, two artifacts. Both directions of the relation are
	// exercised by the same row, which is the shape a real reply-with-image
	// turn writes.
	const sent = await run({
		runId: "artifact-runs-sent",
		specSlug: "core:spec/respond",
		isPreview: false
	})
	await testDb.insert(schema.pipelineRunArtifacts).values([
		{
			runId: sent.id,
			seq: 0,
			kind: "message",
			entityId: messageId,
			action: "created"
		},
		{
			runId: sent.id,
			seq: 1,
			kind: "file",
			entityId: madeFileId,
			action: "created"
		}
	])

	// A later preview over the same image — a re-generation that was looked at
	// and stopped. It is newer and weaker, and both facts have to survive.
	const previewed = await run({
		runId: "artifact-runs-preview",
		specSlug: "core:spec/generate-image",
		isPreview: true
	})
	await testDb.insert(schema.pipelineRunArtifacts).values({
		runId: previewed.id,
		seq: 0,
		kind: "file",
		entityId: madeFileId,
		action: "updated"
	})
}, 120_000)

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

describe("pipelines:artifactRuns", () => {
	it("names every run that produced an image, newest first and labelled", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(ownerId, true),
			{ kind: "file", entityId: madeFileId } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeUndefined()
		expect(res.kind).toBe("file")
		expect(res.entityId).toBe(madeFileId)
		expect(events.map((e) => e.event)).toContain("pipelines:artifactRuns")
		// Both, in the order the reader hands them over. Filtering the preview
		// out here would be this handler deciding which record a person wanted.
		expect(res.runs.map((r: any) => r.runId)).toEqual([
			"artifact-runs-preview",
			"artifact-runs-sent"
		])
		expect(res.runs[0].isPreview).toBe(true)
		expect(res.runs[0].specSlug).toBe("core:spec/generate-image")
		expect(res.runs[1].isPreview).toBe(false)
		expect(res.runs[1].startedAt).toBeDefined()
	}, 60_000)

	it("refuses an image the caller does not own, with the sentence a missing one gets", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(strangerId),
			{ kind: "file", entityId: madeFileId } as any,
			(event, data) => events.push({ event, data })
		)
		// The run belongs to the owner and so does the image. Gating on the run
		// would have refused this too — and would have let a *guest* of the
		// owner's session read an image that has nothing to do with them.
		expect(res.error).toBe("No such image.")
		expect(res.runs).toEqual([])
		expect(events.map((e) => e.event)).toContain(
			"pipelines:artifactRuns:error"
		)
	}, 60_000)

	it("says nothing rather than guessing when no run claims the row", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(ownerId, true),
			{ kind: "file", entityId: uploadedFileId } as any,
			noop
		)
		// An uploaded image is not an error and not a run — it is an image with
		// no provenance, and the panel shows nothing for it.
		expect(res.error).toBeUndefined()
		expect(res.runs).toEqual([])
	}, 60_000)

	it("lets a guest read the runs behind a reply in their own session", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(guestId),
			{ kind: "message", entityId: messageId } as any,
			noop
		)
		// The run is the owner's; the gate is the session — the same asymmetry
		// `pipelines:messageExplain` exists to honour.
		expect(res.error).toBeUndefined()
		expect(res.runs.map((r: any) => r.runId)).toEqual([
			"artifact-runs-sent"
		])
	}, 60_000)

	it("refuses a stranger a message's runs", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(strangerId),
			{ kind: "message", entityId: messageId } as any,
			noop
		)
		expect(res.error).toBe("No such message.")
		expect(res.runs).toEqual([])
	}, 60_000)

	it("refuses a kind it has no gate for rather than answering ungated", async () => {
		const { pipelinesArtifactRuns } = await import("./pipelines")
		const res: any = await pipelinesArtifactRuns.handler(
			fakeSocket(ownerId, true),
			{ kind: "variant", entityId: 1 } as any,
			noop
		)
		// `variant` and `lore_entry` are written by producers with no reader
		// asking this yet. Answering them would mean inventing a gate nothing
		// tests, which is how an ungated read gets shipped.
		expect(res.error).toBe("No such row.")
		expect(res.runs).toEqual([])
	}, 60_000)
})
