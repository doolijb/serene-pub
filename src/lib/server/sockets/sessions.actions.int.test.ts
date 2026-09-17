/**
 * The action model over the sockets (plans/29 R-15; 09-B B9, F38; plans/30
 * U5c, 2026-09-16).
 *
 * What is pinned:
 *
 *  1. **`listSessionActions` respects the audience.** The owner may act on
 *     the composer's contributed actions; a guest sees them (`see:
 *     participant`) but may not act (`act: owner`); a stranger gets every
 *     venue empty. Core's verbs ride the same list: stop is any member's,
 *     branch the owner's, the item-gated ones ask per message.
 *  2. **`quick` places.** A quick action is in the primary set, the rest in
 *     the overflow; the floors are always present; a verb the genre
 *     switches off is absent.
 *  3. **A newly installed action lands in the overflow marked new**, for a
 *     person who has not met it, and the mark clears after
 *     `sessions:actionsSeen`.
 *  4. **Channels filter.** A venue naming a channel appears there and
 *     nowhere else; one naming none appears everywhere.
 *  5. **The fire reads the declaration it was handed.** `sessions:
 *     triggerFunction` keys on the action's identity (`<spec slug>#<key>`,
 *     U5c review W1): a guest is admitted for an action declaring `act:
 *     ['participant']` and refused under the default audience, with a
 *     sentence naming it; a call naming no action gets the owner floor.
 *  6. **Two actions on one function are two things** (W1): each honoured
 *     separately — the guest firing the plugin's runs the PLUGIN spec, the
 *     guest firing core's is refused; enablement is per action, and the
 *     bare function key names one only while one carries it.
 *  7. **R-6 narrowing.** A session owner may bind a function only to a spec
 *     whose own action is enabled for the session — another contributor's
 *     enabled action of the same function does not admit it.
 *  8. **Channels filter venues, never audiences** (W2): a guest on `phone`
 *     fires a `phone`-only action declaring `act: ['participant']`, channel
 *     named or not.
 *  9. **One slash name means one function across the install**: publishing a
 *     second spec that claims a name for a different function is refused —
 *     and a release swapping two names between two specs is not (S2): the
 *     seed's batch excludes its batch-mates per publish and runs the whole
 *     install's rule once after.
 * 10. **`sessions:actionsSeen` stores identities and nothing else** (S3).
 * 11. **Nothing ships a `session_functions` row**, so the per-action keying
 *     (W1) needs no migration; the ⏳ bare-key fallback is for rows a person
 *     wrote before it.
 * 12. **A preset curates by identity** (second pass, W-A; third pass W4+W2):
 *     a stored bare key names the genre's sole declarer of that function,
 *     of any origin, and nothing when several carry it; an identity
 *     includes its action alone; both writers validate by identity and
 *     land a bare sole-declarer key as its identity.
 * 13. **A block's choice carries the writing spec's identity** (W-E): a
 *     guest's submit naming an `act: ['participant']` declaration runs, a
 *     legacy block naming none is the owner floor.
 * 14. **A mixed audience admits either half** (S-A): `act: ['owner', 'item']`
 *     admits the owner with no message and a guest on their own message.
 * 15. **The fire carries no channel** (W-B): audience is channel-free, so
 *     the field was deleted rather than accepted unread.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SpecDocument } from "@serene-pub/sdk"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/**
 * A spy on the status relay's construction — real behaviour, delegated —
 * so a test can see what `io` a run was built with without needing a node
 * that actually sets a status. `sessions:triggerFunction` used to build its
 * `runSpec` request with no `io` at all, so the relay could never reach
 * `sessions:runStatus` or a live row's `sessionMessage` frame; fixed
 * 2026-09-16 by handing it `socket.io` like every other trigger does.
 */
const statusRelayHooks = vi.hoisted(() => ({ ioSeen: [] as unknown[] }))
vi.mock("$lib/server/pipelines/runtime/runStatus", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/runStatus")
		>()
	return {
		...actual,
		createStatusRelay: (
			opts: Parameters<typeof actual.createStatusRelay>[0]
		) => {
			statusRelayHooks.ioSeen.push(opts.io)
			return actual.createStatusRelay(opts)
		}
	}
})

const CHAT = "core:genre/chat"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-actions-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string, isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, username)
	if (isAdmin) {
		const schema = await import("$lib/server/db/schema")
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, u.id))
	}
	return u
}

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

/** A session with an owner and a guest. */
async function sessionWithGuest(tag: string) {
	const schema = await import("$lib/server/db/schema")
	const owner = await makeUser(`${tag}-owner`)
	const guest = await makeUser(`${tag}-guest`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: CHAT })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id })
	return { owner, guest, session }
}

/**
 * A one-node action spec, published as rows — the way a plugin's would be.
 * `ns` decides the slash grammar; each entry of `action` is spread into one
 * declaration (a single object is one action). `batch` is `saveDocument`'s
 * (S2); `version` lets one slug be republished as a new document.
 */
async function publishActionSpec(
	id: string,
	action: Record<string, unknown> | Record<string, unknown>[],
	opts: { function?: string; batch?: ReadonlySet<string>; version?: string } = {}
) {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { chatGenre } = await import("@serene-pub/core-catalog")
	const declared = Array.isArray(action) ? action : [action]
	const doc: SpecDocument = compile(
		spec(id, {
			version: opts.version ?? "1.0.0",
			taxonomy: { role: "action", genre: CHAT },
			contributes: {
				actions: declared.map((a) => {
					const fn = opts.function ?? String(a.function ?? a.key)
					return {
						key: fn,
						function: fn,
						genre: CHAT,
						venue: { kind: "composer" },
						label: { en: fn },
						...a
					} as any
				})
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre: chatGenre,
				event: "core:event/session-action@1"
			})
			.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	return saveDocument(testDb as any, doc, {
		publish: true,
		...(opts.batch ? { batch: opts.batch } : {})
	})
}

/** The specs that ran for a session, newest last. */
async function runsOf(sessionId: number): Promise<string[]> {
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
	return runs.map((r) => r.specSlug as string)
}

const all = (v?: { primary: any[]; overflow: any[] }) => [
	...(v?.primary ?? []),
	...(v?.overflow ?? [])
]

describe("the seed", () => {
	test("writes no session_functions row — the per-action key needs no migration (W1)", async () => {
		// First, before any test writes one: the shipped seed states no
		// per-session choice, so the identity keying (`<spec slug>#<key>`)
		// meets no bare-function row on a fresh install. The ⏳ fallback in
		// `listSessionFunctions` is for rows a person wrote before it.
		const schema = await import("$lib/server/db/schema")
		expect(await testDb.select().from(schema.sessionFunctions)).toEqual([])
	})
})

describe("listSessionActions — audiences", () => {
	test("owner acts on the composer's contributed actions; a guest sees but may not; a stranger gets nothing", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { owner, guest, session } = await sessionWithGuest("aud")

		const forOwner = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const narrate = all(forOwner.venues.composer).find(
			(a) => a.function === "narrate"
		)
		expect(narrate).toMatchObject({
			key: "narrate",
			specSlug: "core:spec/narrate",
			slash: "narrate",
			quick: true,
			canAct: true,
			itemGated: false,
			origin: "companion",
			audience: { see: ["participant"], act: ["owner"] }
		})

		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		const guestNarrate = all(forGuest.venues.composer).find(
			(a) => a.function === "narrate"
		)
		// Seen — `see: participant` — and grey: `act: owner`.
		expect(guestNarrate?.canAct).toBe(false)

		const stranger = await makeUser("aud-stranger")
		const forStranger = await sessionsActionsHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id },
			noopEmit
		)
		for (const v of Object.values(forStranger.venues))
			expect(all(v)).toEqual([])
	})

	test("core's verbs ride the same list: stop is any member's, branch the owner's, the rest ask per message", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { owner, guest, session } = await sessionWithGuest("verbs")

		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		const msg = all(forGuest.venues.message)
		const byKey = Object.fromEntries(msg.map((a) => [a.key, a]))
		expect(byKey.stop).toMatchObject({
			specSlug: "core",
			origin: "core",
			floor: true,
			canAct: true,
			itemGated: false
		})
		expect(byKey.branch).toMatchObject({ floor: true, canAct: false })
		for (const k of ["edit", "retry", "continue", "swipe", "hide", "delete"])
			expect(byKey[k], k).toMatchObject({ itemGated: true, canAct: true })

		const forOwner = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(
			all(forOwner.venues.message).find((a) => a.key === "branch")?.canAct
		).toBe(true)
	})
})

describe("listSessionActions — placement", () => {
	test("quick → primary, else overflow; the floors are always present", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { owner, session } = await sessionWithGuest("place")
		const res = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const composer = res.venues.composer
		expect(composer.primary.map((a) => a.function)).toContain("narrate")
		// Echo ships without `quick`: the overflow lists it, the palette
		// reaches it as `/echo`, and it is never on the primary row.
		expect(composer.overflow.map((a) => a.function)).toContain("echo")
		expect(composer.primary.map((a) => a.function)).not.toContain("echo")

		const message = res.venues.message
		expect(message.primary.map((a) => a.key).sort()).toEqual([
			"edit",
			"retry",
			"stop"
		])
		expect(message.overflow.map((a) => a.key).sort()).toEqual([
			"branch",
			"continue",
			"delete",
			"hide",
			"swipe"
		])
		// retry and continue also live in the extra tab.
		expect(all(res.venues.extra).map((a) => a.key).sort()).toEqual([
			"continue",
			"retry"
		])
		// Every venue kind is present, even the ones nothing declares for.
		for (const k of ["widget", "session-settings", "pipelines", "admin", "review"])
			expect(res.venues[k]).toEqual({ primary: [], overflow: [] })
	})
})

describe("a newly installed action", () => {
	test("lands in the overflow marked new, and the mark clears after sessions:actionsSeen", async () => {
		const { sessionsActionsHandler, sessionsActionsSeenHandler } =
			await import("./sessions")
		const { setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { owner, session } = await sessionWithGuest("new")
		const admin = await makeUser("new-admin", true)

		// A plugin's action: foreign namespace, so an attachment — available
		// once an administrator includes it (the companion rule, 19 §3).
		await publishActionSpec("acme:spec/roll", { key: "roll" })
		const set = await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"roll",
			true,
			{ userId: admin.id, isAdmin: true }
		)
		expect(set.ok).toBe(true)

		const before = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const roll = before.venues.composer.overflow.find(
			(a) => a.function === "roll"
		)
		expect(roll).toMatchObject({
			specSlug: "acme:spec/roll",
			slash: "acme.roll",
			origin: "attachment",
			isNew: true
		})
		expect(
			before.venues.composer.primary.find((a) => a.function === "roll")
		).toBeUndefined()

		const seen = await sessionsActionsSeenHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, keys: ["acme:spec/roll#roll"] },
			noopEmit
		)
		expect(seen.seen).toBe(1)

		const after = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(
			after.venues.composer.overflow.find((a) => a.function === "roll")
				?.isNew
		).toBe(false)

		// Per user: another member has not met it.
		const { guest } = await sessionWithGuest("new-other")
		await testDb
			.insert((await import("$lib/server/db/schema")).sessionGuests)
			.values({ sessionId: session.id, userId: guest.id })
		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(
			all(forGuest.venues.composer).find((a) => a.function === "roll")
				?.isNew
		).toBe(true)

		// Idempotent: seeing it twice records nothing new.
		const again = await sessionsActionsSeenHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, keys: ["acme:spec/roll#roll"] },
			noopEmit
		)
		expect(again.seen).toBe(0)
	})
})

describe("channels", () => {
	test("a venue naming a channel appears there and nowhere else", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { owner, session } = await sessionWithGuest("chan")
		// Core namespace → companion → on by default.
		await publishActionSpec("core:spec/test-phone-text", {
			key: "text",
			function: "text",
			venue: [{ kind: "composer", channel: "phone" }]
		})

		const main = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(main.channel).toBe("main")
		expect(all(main.venues.composer).map((a) => a.function)).not.toContain(
			"text"
		)
		// …but the ones declared with no channel are still there.
		expect(all(main.venues.composer).map((a) => a.function)).toContain(
			"narrate"
		)

		const phone = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, channel: "phone" },
			noopEmit
		)
		expect(phone.channel).toBe("phone")
		const text = all(phone.venues.composer).find((a) => a.function === "text")
		expect(text).toMatchObject({ channel: "phone", slash: "text" })
		expect(all(phone.venues.composer).map((a) => a.function)).toContain(
			"narrate"
		)
		// A lane of the channel is the channel (ruling 2026-09-09).
		const lane = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, channel: "phone:2" },
			noopEmit
		)
		expect(all(lane.venues.composer).map((a) => a.function)).toContain("text")
	})
})

describe("sessions:triggerFunction reads the declaration it was handed", () => {
	test("act: ['participant'] admits a guest; the default refuses one, naming the audience; no action named is the owner floor", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const { owner, guest, session } = await sessionWithGuest("fire")

		// Both core-namespaced so the companion rule turns them on.
		await publishActionSpec("core:spec/test-open-action", {
			key: "wave",
			function: "wave",
			audience: { see: ["participant"], act: ["participant"] }
		})
		await publishActionSpec("core:spec/test-owner-action", {
			key: "bow",
			function: "bow"
		})

		const refused = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				function: "bow",
				action: "core:spec/test-owner-action#bow"
			},
			noopEmit
		)
		expect(refused.error).toBe(
			"'bow' is not yours to use here — its audience is owner."
		)

		const admitted = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				function: "wave",
				action: "core:spec/test-open-action#wave"
			},
			noopEmit
		)
		// Past the audience: whatever the run then did, it was not a
		// refusal at the door.
		expect(admitted.error ?? "").not.toMatch(/not yours to use|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-open-action")

		// Legacy — no action named — is the owner floor, whatever the
		// declaration widened its audience to (W1): the narrowest reading.
		const legacy = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, function: "wave" },
			noopEmit
		)
		expect(legacy.error).toBe(
			"'wave' is not yours to use here — its audience is owner."
		)

		// A malformed identity is refused as such, never read as legacy.
		const malformed = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, function: "wave", action: "wave" },
			noopEmit
		)
		expect(malformed.error).toBe(
			"'wave' is not an action — one is named '<spec slug>#<key>'."
		)
		// …and one naming a declaration that does not serve the function.
		const mismatched = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "wave",
				action: "core:spec/test-owner-action#bow"
			},
			noopEmit
		)
		expect(mismatched.error).toBe(
			"No action 'core:spec/test-owner-action#bow' serves 'wave' for this session."
		)

		// The owner is admitted by the default, as ever — named or not.
		for (const params of [
			{ sessionId: session.id, function: "bow" },
			{
				sessionId: session.id,
				function: "bow",
				action: "core:spec/test-owner-action#bow"
			}
		]) {
			const byOwner = await sessionsTriggerFunctionHandler.handler(
				fakeSocket(owner.id),
				params,
				noopEmit
			)
			expect(byOwner.error ?? "").not.toMatch(
				/not yours to use|Session not found/
			)
		}

		// A stranger is still nobody.
		const stranger = await makeUser("fire-stranger")
		const outside = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(stranger.id),
			{
				sessionId: session.id,
				function: "wave",
				action: "core:spec/test-open-action#wave"
			},
			noopEmit
		)
		expect(outside.error).toBe("Session not found.")
	}, 60_000)

	test("two actions on one function are two things: each audience honoured, each spec its own, enablement per action (W1)", async () => {
		const { sessionsTriggerFunctionHandler, sessionsActionsHandler } =
			await import("./sessions")
		const { setSessionFunction, listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { owner, guest, session } = await sessionWithGuest("two")
		const admin = await makeUser("two-admin", true)

		// Core's `sum` — the companion, owner-only by default — and a plugin's
		// `sum` open to any participant. The attack this pins: the plugin's
		// wider audience must not let a guest run core's spec.
		await publishActionSpec("core:spec/test-sum", { key: "sum", function: "sum" })
		await publishActionSpec("acme:spec/sum", {
			key: "sum",
			function: "sum",
			audience: { see: ["participant"], act: ["participant"] }
		})
		// The attachment is off until an administrator includes it — by
		// identity, because the bare key now names two actions.
		const ambiguous = await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"sum",
			true,
			{ userId: admin.id, isAdmin: true }
		)
		expect(ambiguous.ok).toBe(false)
		expect(ambiguous.error).toBe(
			"'sum' names 2 actions here — core:spec/test-sum#sum, acme:spec/sum#sum. Say which."
		)
		const set = await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"acme:spec/sum#sum",
			true,
			{ userId: admin.id, isAdmin: true }
		)
		expect(set).toMatchObject({ ok: true, enabled: true })
		// Stored by identity, and independent of core's.
		const schema = await import("$lib/server/db/schema")
		expect(
			(
				await testDb
					.select({ functionKey: schema.sessionFunctions.functionKey })
					.from(schema.sessionFunctions)
					.where(eq(schema.sessionFunctions.sessionId, session.id))
			).map((r) => r.functionKey)
		).toEqual(["acme:spec/sum#sum"])
		const listed = (
			await listSessionFunctions(testDb as any, session.id, CHAT, owner.id)
		).filter((f) => f.function === "sum")
		expect(
			Object.fromEntries(listed.map((f) => [f.specSlug, f.enabled]))
		).toEqual({ "core:spec/test-sum": true, "acme:spec/sum": true })

		// The guest sees both, may act on the plugin's alone.
		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		const sums = all(forGuest.venues.composer).filter((a) => a.function === "sum")
		expect(
			Object.fromEntries(sums.map((a) => [a.specSlug, a.canAct]))
		).toEqual({ "core:spec/test-sum": false, "acme:spec/sum": true })

		// Firing the plugin's runs the PLUGIN spec — not the companion the
		// verdict would otherwise choose for `sum`.
		const before = (await runsOf(session.id)).length
		const viaPlugin = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, function: "sum", action: "acme:spec/sum#sum" },
			noopEmit
		)
		expect(viaPlugin.error ?? "").not.toMatch(/not yours|Session not found/)
		const after = await runsOf(session.id)
		expect(after.length).toBe(before + 1)
		expect(after.at(-1)).toBe("acme:spec/sum")

		// Firing core's is refused — the plugin's audience is the plugin's.
		const viaCore = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, function: "sum", action: "core:spec/test-sum#sum" },
			noopEmit
		)
		expect(viaCore.error).toBe(
			"'sum' is not yours to use here — its audience is owner."
		)
		// …and the legacy call, naming neither, is the owner floor.
		const legacy = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, function: "sum" },
			noopEmit
		)
		expect(legacy.error).toMatch(/not yours to use here — its audience is owner/)
		expect((await runsOf(session.id)).length).toBe(before + 1)

		// The owner's legacy call runs the companion — the verdict's own
		// answer when nobody named a spec.
		const ownerLegacy = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, function: "sum" },
			noopEmit
		)
		expect(ownerLegacy.error ?? "").not.toMatch(/not yours|Session not found/)
		expect((await runsOf(session.id)).at(-1)).toBe("core:spec/test-sum")

		// Switching core's off by identity leaves the plugin's on: the
		// owner's named fire of core's is "turned off", the guest's of the
		// plugin's still runs.
		const off = await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"core:spec/test-sum#sum",
			false,
			{ userId: owner.id }
		)
		expect(off).toMatchObject({ ok: true, enabled: false })
		const offFire = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, function: "sum", action: "core:spec/test-sum#sum" },
			noopEmit
		)
		expect(offFire.error).toMatch(/'sum' is turned off for this session/)
		const stillOn = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, function: "sum", action: "acme:spec/sum#sum" },
			noopEmit
		)
		expect(stillOn.error ?? "").not.toMatch(/turned off|not yours/)
	}, 60_000)

	test("a bare-function row written before the identity key still answers, until the next write replaces it (⏳)", async () => {
		const { listSessionFunctions, setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("legacy-row")
		// A person's pre-upgrade off-switch for narrate.
		await testDb.insert(schema.sessionFunctions).values({
			sessionId: session.id,
			genreId: CHAT,
			functionKey: "narrate",
			enabled: false
		})
		const narrate = (
			await listSessionFunctions(testDb as any, session.id, CHAT, owner.id)
		).find((f) => f.specSlug === "core:spec/narrate")
		expect(narrate).toMatchObject({ enabled: false, source: "session", explicit: true })

		// The next write stores the identity and retires the bare row.
		await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"core:spec/narrate#narrate",
			false,
			{ userId: owner.id }
		)
		expect(
			(
				await testDb
					.select({ functionKey: schema.sessionFunctions.functionKey })
					.from(schema.sessionFunctions)
					.where(eq(schema.sessionFunctions.sessionId, session.id))
			).map((r) => r.functionKey)
		).toEqual(["core:spec/narrate#narrate"])
	}, 60_000)

	test("a channel filters where an action is listed, never who may fire it (W2)", async () => {
		const { sessionsTriggerFunctionHandler, sessionsActionsHandler } =
			await import("./sessions")
		const { guest, session } = await sessionWithGuest("phone")
		await publishActionSpec("core:spec/test-phone-wave", {
			key: "phone-wave",
			function: "phone-wave",
			venue: [{ kind: "composer", channel: "phone" }],
			audience: { see: ["participant"], act: ["participant"] }
		})
		// Listed on phone, not on main…
		const onPhone = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, channel: "phone" },
			noopEmit
		)
		expect(
			all(onPhone.venues.composer).find((a) => a.function === "phone-wave")
		).toMatchObject({ canAct: true, channel: "phone" })
		const onMain = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(
			all(onMain.venues.composer).find((a) => a.function === "phone-wave")
		).toBeUndefined()

		// …and fired by a guest it runs. The fire names no channel at all
		// (W-B): audience is not per-channel, so the field was deleted from
		// the params rather than carried unread.
		const res = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				function: "phone-wave",
				action: "core:spec/test-phone-wave#phone-wave"
			},
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/not yours|Session not found|No action/)
		expect(
			(await runsOf(session.id)).filter((s) => s === "core:spec/test-phone-wave")
				.length
		).toBe(1)
	}, 60_000)

	test("a block's choice carries the writing spec's identity: a guest's submit from an `act: ['participant']` spec runs; a legacy block (no identity) is the owner floor (W-E)", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { guest, session } = await sessionWithGuest("block")
		await publishActionSpec("core:spec/test-lock", {
			key: "pick",
			function: "pick-lock",
			venue: { kind: "message" },
			audience: { see: ["participant"], act: ["participant"] }
		})
		// The message the block lives in — a reply, as a block-bearing part
		// would be — and what the client sends on a choice: the block's `fn`,
		// its stamped `action`, the message as subject, the choice as payload.
		const [reply] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				content: "A locked door.",
				isNarratorResponse: true
			})
			.returning()
		const submit = (action?: string) =>
			sessionsTriggerFunctionHandler.handler(
				fakeSocket(guest.id),
				{
					sessionId: session.id,
					function: "pick-lock",
					...(action ? { action } : {}),
					messageId: reply!.id,
					payload: { choice: "pick" }
				},
				noopEmit
			)
		const stamped = await submit("core:spec/test-lock#pick")
		expect(stamped.error ?? "").not.toMatch(/not yours|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-lock")

		// A block stored before identities carries none: the owner floor,
		// whatever the spec widened its audience to.
		const legacy = await submit()
		expect(legacy.error).toBe(
			"'pick-lock' is not yours to use here — its audience is owner."
		)
		expect(
			(await runsOf(session.id)).filter((s) => s === "core:spec/test-lock").length
		).toBe(1)
	}, 60_000)

	test("a mixed audience admits either half: the owner without a message, a guest on their own message (S-A)", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithGuest("mixed")
		await publishActionSpec("core:spec/test-mixed", {
			key: "mixed",
			function: "mixed",
			venue: [{ kind: "composer" }, { kind: "message" }],
			audience: { see: ["participant"], act: ["owner", "item"] }
		})
		const fire = (userId: number, messageId?: number) =>
			sessionsTriggerFunctionHandler.handler(
				fakeSocket(userId),
				{
					sessionId: session.id,
					function: "mixed",
					action: "core:spec/test-mixed#mixed",
					...(messageId != null ? { messageId } : {})
				},
				noopEmit
			)
		// The owner holds `owner`: admitted from the composer, no message
		// named — the item half is not the only door.
		const byOwner = await fire(owner.id)
		expect(byOwner.error ?? "").not.toMatch(/not yours|Session not found/)

		// The guest holds neither reference; the item rule decides against
		// the message: theirs (spoken through their own persona) admits,
		// somebody else's refuses, none refuses.
		const [guestPersona] = await testDb
			.insert(schema.characters)
			.values({ userId: guest.id, name: "Guest", description: "", isPersona: true })
			.returning()
		const [ownerPersona] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Owner", description: "", isPersona: true })
			.returning()
		const [own] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				userId: guest.id,
				personaId: guestPersona!.id,
				role: "user",
				content: "mine"
			})
			.returning()
		const [theirs] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				userId: owner.id,
				personaId: ownerPersona!.id,
				role: "user",
				content: "not mine"
			})
			.returning()
		const onOwn = await fire(guest.id, own!.id)
		expect(onOwn.error ?? "").not.toMatch(/not yours|Session not found/)
		const onTheirs = await fire(guest.id, theirs!.id)
		expect(onTheirs.error).toBe(
			"'mixed' is not yours to use here — its audience is owner, item."
		)
		const noMessage = await fire(guest.id)
		expect(noMessage.error).toBe(
			"'mixed' is not yours to use here — its audience is owner, item."
		)
	}, 60_000)
})

describe("sessions:actionsSeen", () => {
	test("stores identities and drops everything else (S3)", async () => {
		const { sessionsActionsSeenHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("seen-shape")
		const res = await sessionsActionsSeenHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				keys: [
					"core:spec/narrate#narrate",
					"narrate",
					"#narrate",
					"core:spec/narrate#",
					"<script>alert(1)</script>#x",
					`${"a".repeat(200)}#k`,
					42 as any,
					null as any,
					"acme:spec/roll#roll-again"
				]
			},
			noopEmit
		)
		expect(res.seen).toBe(2)
		expect(
			(
				await testDb
					.select({ actionKey: schema.seenActions.actionKey })
					.from(schema.seenActions)
					.where(eq(schema.seenActions.userId, owner.id))
			)
				.map((r) => r.actionKey)
				.sort()
		).toEqual(["acme:spec/roll#roll-again", "core:spec/narrate#narrate"])
	})
})

/**
 * W-A (U5c review, ruled 2026-09-16): a preset curates actions by identity.
 * `included_actions` stores `<spec slug>#<key>`; a bare function key left in
 * a stored row (⏳) includes the companion's action and never an attachment;
 * the writers validate by identity and land a bare companion key as its
 * identity.
 */
describe("a preset includes actions by identity (W-A)", () => {
	test("a stored bare `summarize` two actions declare includes NEITHER; a bare key with one declarer of any origin includes that one; an identity includes its action alone", async () => {
		const { listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("preset-identity")
		await publishActionSpec("core:spec/test-summarize", {
			key: "summarize",
			function: "summarize"
		})
		await publishActionSpec("acme:spec/summarize", {
			key: "summarize",
			function: "summarize"
		})
		// `tally`: one declarer, an attachment — the sole-declarer rule
		// (third pass W4+W2) promotes it regardless of origin.
		await publishActionSpec("acme:spec/tally", { key: "tally", function: "tally" })
		const [preset] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: "Bare summarize",
				genreId: CHAT,
				bindings: {},
				// The pre-identity shape a stored row may still carry.
				includedActions: ["summarize", "tally"]
			})
			.returning()
		await testDb
			.update(schema.sessions)
			.set({ presetId: preset!.id })
			.where(eq(schema.sessions.id, session.id))

		const byIdentity = async (fn: string) =>
			Object.fromEntries(
				(await listSessionFunctions(testDb as any, session.id, CHAT, owner.id))
					.filter((f) => f.function === fn)
					.map((f) => [f.specSlug, { included: f.included, enabled: f.enabled }])
			)
		// A bare key two actions carry names none of them — never a
		// namespace pick — while a bare key one attachment carries names it.
		expect(await byIdentity("summarize")).toEqual({
			"core:spec/test-summarize": { included: false, enabled: false },
			"acme:spec/summarize": { included: false, enabled: false }
		})
		expect(await byIdentity("tally")).toEqual({
			"acme:spec/tally": { included: true, enabled: true }
		})

		// The attachment's identity names the attachment alone.
		await testDb
			.update(schema.sessionPresets)
			.set({ includedActions: ["acme:spec/summarize#summarize"] })
			.where(eq(schema.sessionPresets.id, preset!.id))
		expect(await byIdentity("summarize")).toEqual({
			"core:spec/test-summarize": { included: false, enabled: false },
			"acme:spec/summarize": { included: true, enabled: true }
		})
	}, 60_000)

	test("sessionPresets:update validates by identity: a bare key two actions carry is refused naming both, a companion's lands as its identity, an attachment's identity is stored", async () => {
		const { sessionPresetsUpdate } = await import("./sessionAdmin")
		const schema = await import("$lib/server/db/schema")
		const admin = await makeUser("preset-identity-admin", true)
		// `summarize` is carried twice by the test above (same database);
		// `narrate` once, by the shipped companion.
		// Disabled, so the bindings contract (an enabled preset binds its
		// required slots) is not the refusal under test.
		const [preset] = await testDb
			.insert(schema.sessionPresets)
			.values({ name: "Curated", genreId: CHAT, bindings: {}, enabled: false })
			.returning()

		const ambiguous = await sessionPresetsUpdate.handler(
			fakeSocket(admin.id, true),
			{ id: preset!.id, includedActions: ["summarize"] },
			noopEmit
		)
		expect(ambiguous.error).toBe(
			"'summarize' names 2 actions here — core:spec/test-summarize#summarize, acme:spec/summarize#summarize. " +
				"A preset includes an action by its identity ('<spec slug>#<key>'). Say which."
		)
		const unknown = await sessionPresetsUpdate.handler(
			fakeSocket(admin.id, true),
			{ id: preset!.id, includedActions: ["acme:spec/summarize#nope"] },
			noopEmit
		)
		expect(unknown.error).toMatch(/nothing contributes 'acme:spec\/summarize#nope'/)

		const stored = await sessionPresetsUpdate.handler(
			fakeSocket(admin.id, true),
			{
				id: preset!.id,
				includedActions: ["narrate", "acme:spec/summarize#summarize"]
			},
			noopEmit
		)
		expect(stored.error).toBeUndefined()
		expect(stored.preset?.includedActions).toEqual([
			"core:spec/narrate#narrate",
			"acme:spec/summarize#summarize"
		])
	}, 60_000)

	test("sessionPresets:create with fromPresetId promotes a copied bare key with one declarer and keeps the rest bare, never refusing (S1)", async () => {
		const { sessionPresetsCreate } = await import("./sessionAdmin")
		const schema = await import("$lib/server/db/schema")
		const admin = await makeUser("preset-copy-admin", true)
		// A source row from before identities: `narrate` (one declarer, the
		// shipped companion), `tally` (one declarer, an attachment — see the
		// first test in this block), `summarize` (two) and a stranger.
		const [source] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: "Pre-identity source",
				genreId: CHAT,
				bindings: {},
				enabled: false,
				includedActions: [
					"narrate",
					"tally",
					"summarize",
					"teleport",
					"acme:spec/summarize#summarize"
				]
			})
			.returning()
		const res = await sessionPresetsCreate.handler(
			fakeSocket(admin.id, true),
			{ name: "Copied", genreId: CHAT, fromPresetId: source!.id },
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.preset?.includedActions).toEqual([
			"core:spec/narrate#narrate",
			"acme:spec/tally#tally",
			"summarize",
			"teleport",
			"acme:spec/summarize#summarize"
		])
		// The source is left as it was: a copy reads, it does not repair.
		const [again] = await testDb
			.select({ includedActions: schema.sessionPresets.includedActions })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, source!.id))
		expect(again!.includedActions).toEqual([
			"narrate",
			"tally",
			"summarize",
			"teleport",
			"acme:spec/summarize#summarize"
		])
	}, 60_000)

	test("pipelines:setPresetActions (the legacy squat) runs the same normaliser", async () => {
		const { setPresetActions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const schema = await import("$lib/server/db/schema")
		const [respond] = await testDb
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
			.limit(1)
		const [cfg] = await testDb
			.insert(schema.pipelineConfigs)
			.values({ specId: respond!.id, name: "Squat" })
			.returning()
		const refused = await setPresetActions(testDb as any, cfg!.id, {
			includedActions: ["summarize"]
		})
		expect(refused.ok).toBe(false)
		expect(refused.error).toMatch(/'summarize' names 2 actions here/)
		const ok = await setPresetActions(testDb as any, cfg!.id, {
			includedActions: ["narrate"]
		})
		expect(ok.ok).toBe(true)
		const [row] = await testDb
			.select({ includedActions: schema.pipelineConfigs.includedActions })
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, cfg!.id))
		expect(row!.includedActions).toEqual(["core:spec/narrate#narrate"])
	}, 60_000)
})

describe("R-6 narrowing at sessions:bindFunction", () => {
	test("a session owner may bind only to a spec whose action is enabled for the session", async () => {
		const { sessionsBindFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("r6")

		// A plugin's contribution: published, resolvable, and — being an
		// attachment — not enabled until an administrator includes it.
		await publishActionSpec("acme:spec/greet", {
			key: "greet",
			function: "greet"
		})

		const refused = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet",
				specSlug: "acme:spec/greet",
				scope: "session"
			},
			noopEmit
		)
		expect(refused.error).toMatch(
			/'greet' from 'acme:spec\/greet' is not enabled for this session/
		)
		expect(
			await testDb
				.select()
				.from(schema.pipelineFunctionBindings)
				.where(eq(schema.pipelineFunctionBindings.scopeId, session.id))
		).toEqual([])

		// The candidate rule still stands underneath: a spec that does not
		// serve the function is refused as such, not as "not enabled".
		const wrongSpec = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet",
				specSlug: "core:spec/narrate",
				scope: "session"
			},
			noopEmit
		)
		expect(wrongSpec.error).toMatch(/does not serve 'greet'/)

		// The administrator widens availability: once included, the same
		// bind succeeds — the choice was always within what was available.
		const admin = await makeUser("r6-admin", true)
		const { setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const set = await setSessionFunction(
			testDb as any,
			session.id,
			CHAT,
			"greet",
			true,
			{ userId: admin.id, isAdmin: true }
		)
		expect(set).toMatchObject({ ok: true, enabled: true })
		const now = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet",
				specSlug: "acme:spec/greet",
				scope: "session"
			},
			noopEmit
		)
		expect(now.error).toBeUndefined()
		expect(
			(
				await testDb
					.select()
					.from(schema.pipelineFunctionBindings)
					.where(eq(schema.pipelineFunctionBindings.scopeId, session.id))
			).length
		).toBe(1)

		// An enabled companion binds first time: `narrate` is on by default.
		const companion = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "narrate",
				specSlug: "core:spec/narrate",
				scope: "session"
			},
			noopEmit
		)
		expect(companion.error).toBeUndefined()
	}, 60_000)

	test("a contributor whose own action is not enabled is refused, even when another action of the function is (W1)", async () => {
		const { sessionsBindFunctionHandler, sessionsFunctionCandidatesHandler } =
			await import("./sessions")
		const { owner, session } = await sessionWithGuest("r6-two")
		// Core's `greet2` is a companion (on); the plugin's is an attachment
		// (off). The function IS enabled — through core's — and that must
		// not admit the plugin's spec.
		await publishActionSpec("core:spec/test-greet2", { key: "greet2", function: "greet2" })
		await publishActionSpec("acme:spec/greet2", { key: "greet2", function: "greet2" })

		const refused = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet2",
				specSlug: "acme:spec/greet2",
				scope: "session"
			},
			noopEmit
		)
		expect(refused.error).toMatch(
			/'greet2' from 'acme:spec\/greet2' is not enabled for this session/
		)
		// The picker offers only what the bind would take (S8).
		const picker = await sessionsFunctionCandidatesHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, function: "greet2" },
			noopEmit
		)
		expect(picker.candidates).toEqual(["core:spec/test-greet2"])
		expect(picker.resolved).toBe("core:spec/test-greet2")

		// The companion's own binds.
		const ok = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet2",
				specSlug: "core:spec/test-greet2",
				scope: "session"
			},
			noopEmit
		)
		expect(ok.error).toBeUndefined()

		// An administrator enabling the plugin's action — by identity —
		// widens what the session may choose.
		const admin = await makeUser("r6-two-admin", true)
		const { setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			await setSessionFunction(
				testDb as any,
				session.id,
				CHAT,
				"acme:spec/greet2#greet2",
				true,
				{ userId: admin.id, isAdmin: true }
			)
		).toMatchObject({ ok: true })
		const now = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				function: "greet2",
				specSlug: "acme:spec/greet2",
				scope: "session"
			},
			noopEmit
		)
		expect(now.error).toBeUndefined()
		const widened = await sessionsFunctionCandidatesHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, function: "greet2" },
			noopEmit
		)
		expect(widened.candidates.sort()).toEqual([
			"acme:spec/greet2",
			"core:spec/test-greet2"
		])
	}, 60_000)
})

describe("sessions:triggerFunction announces its run (R-19)", () => {
	test("runSpec is built with the socket's io, so the status relay can reach sessions:runStatus and the live row", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const { owner, session } = await sessionWithGuest("announce")

		await publishActionSpec("core:spec/test-announce-action", {
			key: "wink",
			function: "wink"
		})

		statusRelayHooks.ioSeen.length = 0
		const socket = fakeSocket(owner.id)
		const res = await sessionsTriggerFunctionHandler.handler(
			socket,
			{
				sessionId: session.id,
				function: "wink",
				action: "core:spec/test-announce-action#wink"
			},
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/not yours to use|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-announce-action")

		// One run, one relay, built with the caller's own `io` — never
		// `undefined`, which is what silently dropped every status this
		// route ever set.
		expect(statusRelayHooks.ioSeen).toEqual([socket.io])
	}, 60_000)
})

// ⚠ Nothing after this point: the next block deliberately leaves the
// install's slash names colliding, to prove `assertInstallSlashNamesFree`
// catches it (S2) — every later `publishActionSpec` in this file would
// inherit that broken state and fail to publish at all.
describe("one slash name means one function across the install", () => {
	test("publishing a second spec claiming a name for a different function is refused", async () => {
		await publishActionSpec("core:spec/test-slash-one", {
			key: "conjure",
			function: "conjure",
			slash: "cast"
		})
		await expect(
			publishActionSpec("core:spec/test-slash-two", {
				key: "hex",
				function: "hex",
				slash: "cast"
			})
		).rejects.toThrow(/'\/cast' is claimed twice for genre 'core:genre\/chat'/)

		// …while the same function under one name is an alternative.
		await expect(
			publishActionSpec("core:spec/test-slash-three", {
				key: "conjure",
				function: "conjure",
				slash: "cast"
			})
		).resolves.toMatchObject({ written: true })
	}, 60_000)

	test("a core spec cannot shadow a core verb's slash (S1)", async () => {
		await expect(
			publishActionSpec("core:spec/test-shadow-retry", {
				key: "redo",
				function: "redo",
				slash: "retry"
			})
		).rejects.toThrow(/'\/retry' is claimed twice.*by 'core' for 'retry'/)
	}, 60_000)

	test("a release swapping two names between two specs publishes as a batch, and the whole install is checked once after (S2)", async () => {
		const { assertInstallSlashNamesFree } = await import(
			"$lib/server/pipelines/boot/store"
		)
		const A = "core:spec/test-swap-a"
		const B = "core:spec/test-swap-b"
		// Release N: A claims /swap-x for `alpha`, B claims /swap-y for `beta`.
		await publishActionSpec(A, { key: "alpha", function: "alpha", slash: "swap-x" })
		await publishActionSpec(B, { key: "beta", function: "beta", slash: "swap-y" })

		// Release N+1 swaps them. One at a time, A' meets B's old claim.
		await expect(
			publishActionSpec(
				A,
				{ key: "alpha", function: "alpha", slash: "swap-y" },
				{ version: "1.1.0" }
			)
		).rejects.toThrow(/'\/swap-y' is claimed twice/)

		// As a batch — each publish excluding its batch-mates — both land…
		const batch = new Set([A, B])
		await expect(
			publishActionSpec(
				A,
				{ key: "alpha", function: "alpha", slash: "swap-y" },
				{ version: "1.1.0", batch }
			)
		).resolves.toMatchObject({ written: true })
		await expect(
			publishActionSpec(
				B,
				{ key: "beta", function: "beta", slash: "swap-x" },
				{ version: "1.1.0", batch }
			)
		).resolves.toMatchObject({ written: true })
		// …and the install as it now stands is sound.
		await expect(assertInstallSlashNamesFree(testDb as any)).resolves.toBeUndefined()

		// The after-loop check is not decoration: a batch-mate that was
		// excluded but never actually republished leaves a real collision,
		// and this is what catches it.
		const C = "core:spec/test-swap-c"
		await expect(
			publishActionSpec(
				C,
				{ key: "gamma", function: "gamma", slash: "swap-y" },
				{ batch: new Set([C, A]) }
			)
		).resolves.toMatchObject({ written: true })
		await expect(assertInstallSlashNamesFree(testDb as any)).rejects.toThrow(
			/the install's published specs collide on a slash name: '\/swap-y' is claimed twice/
		)
	}, 60_000)
})
