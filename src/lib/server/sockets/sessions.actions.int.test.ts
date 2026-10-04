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
 *     fireAction` keys on the action's identity (`<spec slug>#<key>`,
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
 * 16. **Enabled-when** (U5e, 2026-09-17): a contributed action's predicate
 *     over `state.world.location` lists `enabled: false` with its reason
 *     while the slot is empty and `true` after `state:set`; the door refuses
 *     with the sentence while empty and admits after. A genre's default
 *     applies to an action declaring nothing (proven on a fixture genre —
 *     no shipped genre declares one, review W8); the action's own beats
 *     the default and an explicit `[]` opts out; a session binding
 *     override beats both; clearing it restores. `swipe` on a non-newest
 *     row is refused at the verb's door with the `notNewest` reason, and
 *     the message venue carries the `item.*` predicates the client judges.
 *     `session.generating` greys every verb but stop while a run is live.
 * 17. **Review follow-ups (2026-09-17).** The floors ask their door: an
 *     edit of a hidden row and a branch during generation are refused with
 *     the predicate's sentence (W2). A press naming a row of another
 *     session, or an `item.*` predicate with no row to judge, is refused
 *     (W4). Every finished root pushes `sessions:actions` to each member
 *     once (C1).
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
 * that actually sets a status. `sessions:fireAction` used to build its
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
	opts: {
		/** The key every declaration gets unless it states one. */
		key?: string
		batch?: ReadonlySet<string>
		version?: string
		/**
		 * The genre the spec serves; Chat unless said. Adventure brings the
		 * world slots (U5e); a fixture declaration (`publishFixtureGenre`)
		 * brings whatever the test gave it.
		 */
		genre?: "chat" | "adventure" | import("@serene-pub/sdk").GenreDecl
	} = {}
) {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { chatGenre, adventureGenre } = await import("@serene-pub/core-catalog")
	const genre =
		opts.genre === "adventure"
			? adventureGenre
			: opts.genre && typeof opts.genre === "object"
				? opts.genre
				: chatGenre
	const declared = Array.isArray(action) ? action : [action]
	const doc: SpecDocument = compile(
		spec(id, {
			version: opts.version ?? "1.0.0",
			taxonomy: { role: "action"},
			contributes: {
				actions: declared.map((a) => {
					const key = opts.key ?? String(a.key)
					return {
						key,
						venue: { kind: "composer" },
						label: { en: key },
						// Required since 2026-09-28 (the action legend).
						description: { en: `Test action ${key}.` },
						...a
					} as any
				})
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre,
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

/**
 * A fixture genre under core's namespace (so `core:spec/…` actions are its
 * companions), carrying the location slot — `state.world.location` — and
 * whatever enabled-when defaults the test declares, plus the create spec
 * every genre needs to be a genre (`getSessionGenre` reads the row). No
 * shipped genre declares a default (review W8), so the mechanism is proven
 * here on a genre of the test's own.
 */
async function publishFixtureGenre(
	id: string,
	enabledWhen?: Record<string, Record<string, unknown> | Record<string, unknown>[]>
) {
	const { genre, spec, compile, sessionEvents } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { locationSlot } = await import("@serene-pub/core-catalog")
	const decl = genre(id, {
		name: { en: "Fixture" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0 },
			lorebook: "optional",
			composer: "text",
			voice: "character",
			greeting: { enabled: false }
		},
		slots: [locationSlot as any],
		...(enabledWhen ? { enabledWhen: enabledWhen as any } : {}),
		events: {
			[sessionEvents.messageRespond]: { required: true },
			[sessionEvents.sessionAction]: { open: true }
		}
	})
	const doc: SpecDocument = compile(
		spec(`${id.replace(":genre/", ":spec/")}-create`, {
			version: "1.0.0",
			taxonomy: { role: "create"},
			genre: {
				name: decl.name,
				family: decl.family,
				shape: decl.shape,
				events: decl.events as Record<string, { required?: boolean; open?: boolean }>
			}
		})
			.inlet("input", C.sessionCreated.v1(), {
				genre: decl,
				event: sessionEvents.sessionCreated
			})
			.query("collect", ($) => C.sessionGreetings.v1({ scope: $.input.sessionScope }))
			.outlet("seed", ($) =>
				C.seedGreetings.v1({ greetings: $.collect.greetings, channel: "main" })
			)
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(testDb as any, doc, { publish: true })
	return decl
}

/**
 * The half of a Socket.IO server the interest gate and the emit read — one
 * connected socket per member, each holding `sessions:actions#<session>` as
 * the session page declares it (W-A4), or another session's scope for the
 * ids in `elsewhere` — so a server-side push (`pushSessionActions`) can be
 * counted per user.
 */
function recordingIo(
	userIds: number[],
	sessionId: number,
	elsewhere: Record<number, number> = {}
) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const socketOf = (id: number, scope: number) => ({
		id: `socket-${id}`,
		user: { id, isAdmin: false },
		interest: new Set([`sessions:actions#${scope}`])
	})
	const sockets = new Map<string, ReturnType<typeof socketOf>>([
		...userIds.map((id): [string, ReturnType<typeof socketOf>] => [
			`socket-${id}`,
			socketOf(id, sessionId)
		]),
		...Object.entries(elsewhere).map(
			([id, scope]): [string, ReturnType<typeof socketOf>] => [
				`socket-${id}`,
				socketOf(Number(id), scope)
			]
		)
	])
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => {
						const m = /^user_(\d+)$/.exec(room)
						return m && sockets.has(`socket-${m[1]}`) ? new Set([`socket-${m[1]}`]) : undefined
					}
				}
			},
			sockets: { get: (id: string) => sockets.get(id), values: () => sockets.values() }
		},
		to: (room: string) => ({
			emit: (event: string, payload: any) => emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

/** The specs that ran for a session, newest last. */
async function runsOf(sessionId: number): Promise<string[]> {
	// Event work runs after the writer, on the session's queue (PLAN §8 (27)).
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
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
			(a) => a.key === "narrate"
		)
		expect(narrate).toMatchObject({
			key: "narrate",
			specSlug: "core:spec/narrate",
			slash: "narrate",
			quick: true,
			canAct: true,
			itemGated: false,
			origin: "companion",
			audience: { see: ["participant"], act: ["owner"] },
			// What happens next, optionally (genre uplift C2, 2026-09-29):
			// the listing carries it, so the palette hints `/narrate
			// [<what should happen next>]`, the legend notes it, and a
			// slash argument fires the narration directly.
			collects: {
				text: {
					need: "optional",
					label: "What should happen next?",
					placeholder: "The storm breaks over the harbour.",
					ifEmpty: "The narrator decides."
				}
			}
		})

		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		const guestNarrate = all(forGuest.venues.composer).find(
			(a) => a.key === "narrate"
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
		for (const k of ["edit", "retry", "extend", "swipe", "hide", "delete"])
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
		// A core-namespace companion without `quick` (every shipped Chat
		// action is quick since Echo was removed, owner note 35).
		await publishActionSpec("core:spec/test-unquick", { key: "unquick" })
		const { owner, session } = await sessionWithGuest("place")
		const res = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const composer = res.venues.composer
		expect(composer.primary.map((a) => a.key)).toContain("narrate")
		// Without `quick`: the overflow lists it, the palette reaches it as
		// `/unquick`, and it is never on the primary row.
		expect(composer.overflow.map((a) => a.key)).toContain("unquick")
		expect(composer.primary.map((a) => a.key)).not.toContain("unquick")

		const message = res.venues.message
		expect(message.primary.map((a) => a.key).sort()).toEqual([
			"edit",
			"retry",
			"stop"
		])
		expect(message.overflow.map((a) => a.key).sort()).toEqual([
			"branch",
			"delete",
			"extend",
			"hide",
			"swipe"
		])
		// retry also lives in the extra tab, beside the turn controls
		// `advance` — the composer's Continue, never the prefill (B7) — and
		// `pick` (B8). Chat has no narrator voice, so no `narrate`.
		expect(all(res.venues.extra).map((a) => a.key).sort()).toEqual([
			"advance",
			"pick",
			"retry"
		])
		// Every venue kind is present, even the ones nothing declares for.
		for (const k of ["session-settings", "pipelines", "admin", "review"])
			expect(res.venues[k]).toEqual({ primary: [], overflow: [] })
		// The widget venue holds core's one annex field (retake's "don't ask
		// again", R2 2026-09-28): an annex field is declared for every genre.
		expect(all(res.venues.widget).map((a) => `${a.specSlug}#${a.key}`)).toEqual([
			"core:annex#retake-quietly"
		])
	})

	test("every action the legend lists says what it does (2026-09-28)", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { owner, session } = await sessionWithGuest("legend")
		const res = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const undescribed = ["composer", "extra", "message"].flatMap((venue) =>
			all(res.venues[venue])
				.filter((a) => !a.description?.trim())
				.map((a) => `${venue}:${a.specSlug}#${a.key}`)
		)
		expect(undescribed).toEqual([])
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
			(a) => a.key === "roll"
		)
		expect(roll).toMatchObject({
			specSlug: "acme:spec/roll",
			slash: "acme.roll",
			origin: "foreign",
			isNew: true
		})
		expect(
			before.venues.composer.primary.find((a) => a.key === "roll")
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
			after.venues.composer.overflow.find((a) => a.key === "roll")
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
			all(forGuest.venues.composer).find((a) => a.key === "roll")
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
			venue: [{ kind: "composer", channel: "phone" }]
		})

		const main = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(main.channel).toBe("main")
		expect(all(main.venues.composer).map((a) => a.key)).not.toContain(
			"text"
		)
		// …but the ones declared with no channel are still there.
		expect(all(main.venues.composer).map((a) => a.key)).toContain(
			"narrate"
		)

		const phone = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, channel: "phone" },
			noopEmit
		)
		expect(phone.channel).toBe("phone")
		const text = all(phone.venues.composer).find((a) => a.key === "text")
		expect(text).toMatchObject({ channel: "phone", slash: "text" })
		expect(all(phone.venues.composer).map((a) => a.key)).toContain(
			"narrate"
		)
		// A lane of the channel is the channel (ruling 2026-09-09).
		const lane = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, channel: "phone:2" },
			noopEmit
		)
		expect(all(lane.venues.composer).map((a) => a.key)).toContain("text")
	})
})

describe("sessions:fireAction reads the declaration it was handed", () => {
	test("act: ['participant'] admits a guest; the default refuses one, naming the audience; a bare key resolves to its sole declarer (V2)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { owner, guest, session } = await sessionWithGuest("fire")

		// Both core-namespaced so the companion rule turns them on.
		await publishActionSpec("core:spec/test-open-action", {
			key: "wave",
			audience: { see: ["participant"], act: ["participant"] }
		})
		await publishActionSpec("core:spec/test-owner-action", {
			key: "bow"
		})

		const refused = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				action: "core:spec/test-owner-action#bow"
			},
			noopEmit
		)
		expect(refused.error).toBe(
			"'bow' is not yours to use here — its audience is owner."
		)

		const admitted = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				action: "core:spec/test-open-action#wave"
			},
			noopEmit
		)
		// Past the audience: whatever the run then did, it was not a
		// refusal at the door.
		expect(admitted.error ?? "").not.toMatch(/not yours to use|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-open-action")

		// A bare key (⏳) names its sole declarer, and THAT declaration's
		// audience decides (plans/31 V2 — there is no narrower reading to
		// fall to, because the key names one thing): the guest is admitted.
		const bare = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, key: "wave" },
			noopEmit
		)
		expect(bare.error ?? "").not.toMatch(/not yours to use|Session not found/)
		// …and a bare key nothing declares is refused as such.
		const unknown = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, key: "curtsy" },
			noopEmit
		)
		expect(unknown.error).toBe("No action 'curtsy' is offered to this session.")

		// A malformed identity is refused as such, never read as a key.
		const malformed = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, action: "wave" },
			noopEmit
		)
		expect(malformed.error).toBe(
			"'wave' is not an action — one is named '<spec slug>#<key>'."
		)
		// …and a press naming nothing at all.
		const nothing = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(nothing.error).toBe("A press names the action it fires — '<spec slug>#<key>'.")

		// The owner is admitted by the default, as ever — named or not.
		for (const params of [
			{ sessionId: session.id, key: "bow" },
			{
				sessionId: session.id,
				action: "core:spec/test-owner-action#bow"
			}
		]) {
			const byOwner = await sessionsFireActionHandler.handler(
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
		const outside = await sessionsFireActionHandler.handler(
			fakeSocket(stranger.id),
			{
				sessionId: session.id,
				action: "core:spec/test-open-action#wave"
			},
			noopEmit
		)
		expect(outside.error).toBe("Session not found.")
	}, 60_000)

	test("two actions sharing a key are two things: each audience honoured, each spec its own, enablement per action (W1)", async () => {
		const { sessionsFireActionHandler, sessionsActionsHandler } =
			await import("./sessions")
		const { setSessionFunction, listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { owner, guest, session } = await sessionWithGuest("two")
		const admin = await makeUser("two-admin", true)

		// Core's `sum` — the companion, owner-only by default — and a plugin's
		// `sum` open to any participant. The attack this pins: the plugin's
		// wider audience must not let a guest run core's spec.
		await publishActionSpec("core:spec/test-sum", { key: "sum" })
		await publishActionSpec("acme:spec/sum", {
			key: "sum",
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
		).filter((f) => f.key === "sum")
		expect(
			Object.fromEntries(listed.map((f) => [f.specSlug, f.enabled]))
		).toEqual({ "core:spec/test-sum": true, "acme:spec/sum": true })

		// The guest sees both, may act on the plugin's alone.
		const forGuest = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		const sums = all(forGuest.venues.composer).filter((a) => a.key === "sum")
		expect(
			Object.fromEntries(sums.map((a) => [a.specSlug, a.canAct]))
		).toEqual({ "core:spec/test-sum": false, "acme:spec/sum": true })

		// Firing the plugin's runs the PLUGIN spec — not the companion the
		// verdict would otherwise choose for `sum`.
		const before = (await runsOf(session.id)).length
		const viaPlugin = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, action: "acme:spec/sum#sum" },
			noopEmit
		)
		expect(viaPlugin.error ?? "").not.toMatch(/not yours|Session not found/)
		const after = await runsOf(session.id)
		// The action's run, and the recompute its write causes — which runs
		// on the session's queue, so it may save either side (PLAN §8 (27)).
		expect(after.length).toBe(before + 2)
		expect(after.filter((slug) => !slug.endsWith("-turn-order")).at(-1)).toBe("acme:spec/sum")

		// Firing core's is refused — the plugin's audience is the plugin's.
		const viaCore = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, action: "core:spec/test-sum#sum" },
			noopEmit
		)
		expect(viaCore.error).toBe(
			"'sum' is not yours to use here — its audience is owner."
		)
		// …and a bare key two specs declare names neither (V2): refused with
		// the identities, for the guest and the owner alike — a press has to
		// be about one thing, and no binding selects among two actions.
		for (const who of [guest, owner]) {
			const bare = await sessionsFireActionHandler.handler(
				fakeSocket(who.id),
				{ sessionId: session.id, key: "sum" },
				noopEmit
			)
			expect(bare.error).toBe(
				"'sum' names 2 actions here — core:spec/test-sum#sum, acme:spec/sum#sum. Say which."
			)
		}
		expect((await runsOf(session.id)).length).toBe(before + 2)

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
		const offFire = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, action: "core:spec/test-sum#sum" },
			noopEmit
		)
		expect(offFire.error).toMatch(/'sum' is turned off for this session/)
		const stillOn = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, action: "acme:spec/sum#sum" },
			noopEmit
		)
		expect(stillOn.error ?? "").not.toMatch(/turned off|not yours/)
	}, 60_000)

	test("a session_functions row answers by identity only — a bare key names nothing (plans/31 V2)", async () => {
		const { listSessionFunctions, setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("legacy-row")
		// A row keyed the pre-identity way decides nothing any more: the
		// companion default answers, and the row is not read.
		await testDb.insert(schema.sessionFunctions).values({
			sessionId: session.id,
			genreId: CHAT,
			functionKey: "narrate",
			enabled: false
		})
		const narrate = (
			await listSessionFunctions(testDb as any, session.id, CHAT, owner.id)
		).find((f) => f.specSlug === "core:spec/narrate")
		expect(narrate).toMatchObject({ enabled: true, source: "default", explicit: false })

		// A write stores the identity and answers from then on.
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
				await listSessionFunctions(testDb as any, session.id, CHAT, owner.id)
			).find((f) => f.specSlug === "core:spec/narrate")
		).toMatchObject({ enabled: false, source: "session", explicit: true })
		expect(
			(
				await testDb
					.select({ functionKey: schema.sessionFunctions.functionKey })
					.from(schema.sessionFunctions)
					.where(eq(schema.sessionFunctions.sessionId, session.id))
			)
				.map((r) => r.functionKey)
				.sort()
		).toEqual(["core:spec/narrate#narrate", "narrate"])
	}, 60_000)

	test("a channel filters where an action is listed, never who may fire it (W2)", async () => {
		const { sessionsFireActionHandler, sessionsActionsHandler } =
			await import("./sessions")
		const { guest, session } = await sessionWithGuest("phone")
		await publishActionSpec("core:spec/test-phone-wave", {
			key: "phone-wave",
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
			all(onPhone.venues.composer).find((a) => a.key === "phone-wave")
		).toMatchObject({ canAct: true, channel: "phone" })
		const onMain = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(
			all(onMain.venues.composer).find((a) => a.key === "phone-wave")
		).toBeUndefined()

		// …and fired by a guest it runs. The fire names no channel at all
		// (W-B): audience is not per-channel, so the field was deleted from
		// the params rather than carried unread.
		const res = await sessionsFireActionHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
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

	test("a block's choice carries the writing spec's identity: a guest's submit from an `act: ['participant']` spec runs; a legacy block (no identity) resolves its key to the sole declarer (W-E; V2)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { guest, session } = await sessionWithGuest("block")
		await publishActionSpec("core:spec/test-lock", {
			key: "pick",
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
			sessionsFireActionHandler.handler(
				fakeSocket(guest.id),
				{
					sessionId: session.id,
					...(action ? { action } : { key: "pick" }),
					messageId: reply!.id,
					payload: { choice: "pick" }
				},
				noopEmit
			)
		const stamped = await submit("core:spec/test-lock#pick")
		expect(stamped.error ?? "").not.toMatch(/not yours|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-lock")

		// A block stored before identities carries none: its key names the
		// sole declarer (V2), and that declaration's audience — which admits
		// a guest — decides. There is no narrower reading to fall to.
		const legacy = await submit()
		expect(legacy.error ?? "").not.toMatch(/not yours|Session not found/)
		expect(
			(await runsOf(session.id)).filter((s) => s === "core:spec/test-lock").length
		).toBe(2)
	}, 60_000)

	test("a mixed audience admits either half: the owner without a message, a guest on their own message (S-A)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithGuest("mixed")
		await publishActionSpec("core:spec/test-mixed", {
			key: "mixed",
			venue: [{ kind: "composer" }, { kind: "message" }],
			audience: { see: ["participant"], act: ["owner", "item"] }
		})
		const fire = (userId: number, messageId?: number) =>
			sessionsFireActionHandler.handler(
				fakeSocket(userId),
				{
					sessionId: session.id,
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
			key: "summarize"
		})
		await publishActionSpec("acme:spec/summarize", {
			key: "summarize"
		})
		// `tally`: one declarer, an attachment — the sole-declarer rule
		// (third pass W4+W2) promotes it regardless of origin.
		await publishActionSpec("acme:spec/tally", { key: "tally" })
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
					.filter((f) => f.key === fn)
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

describe("R-6 narrowing at sessions:bindFunction (subjects, plans/31 V2)", () => {
	test("a session owner may bind an action only while it is enabled for the session; the subject names its declarer", async () => {
		const { sessionsBindFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("r6")

		// A plugin's contribution: published, resolvable, and — being an
		// attachment — not enabled until an administrator includes it.
		await publishActionSpec("acme:spec/greet", {
			key: "greet"
		})

		const refused = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "acme:spec/greet#greet",
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
				.from(schema.pipelineBindings)
				.where(eq(schema.pipelineBindings.scopeId, session.id))
		).toEqual([])

		// An action is served by its declarer: naming another spec for it is
		// refused as such, not as "not enabled".
		const wrongSpec = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "acme:spec/greet#greet",
				specSlug: "core:spec/narrate",
				scope: "session"
			},
			noopEmit
		)
		expect(wrongSpec.error).toMatch(/does not serve 'acme:spec\/greet#greet'/)

		// A bare word is not a subject at all.
		const bare = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, subject: "greet", specSlug: "acme:spec/greet", scope: "session" },
			noopEmit
		)
		expect(bare.error).toMatch(/'greet' is not offered to this session's genre|is not something a binding is about/)

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
			"acme:spec/greet#greet",
			true,
			{ userId: admin.id, isAdmin: true }
		)
		expect(set).toMatchObject({ ok: true, enabled: true })
		const now = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "acme:spec/greet#greet",
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
					.from(schema.pipelineBindings)
					.where(eq(schema.pipelineBindings.scopeId, session.id))
			).map((r) => r.subject)
		).toEqual(["acme:spec/greet#greet"])

		// An enabled companion binds first time: `narrate` is on by default.
		const companion = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/narrate#narrate",
				specSlug: "core:spec/narrate",
				scope: "session"
			},
			noopEmit
		)
		expect(companion.error).toBeUndefined()
	}, 60_000)

	test("two specs declaring one key are two subjects: the plugin's is refused until enabled, and never rides on core's (W1; V2)", async () => {
		const { sessionsBindFunctionHandler, sessionsFunctionCandidatesHandler } =
			await import("./sessions")
		const { owner, session } = await sessionWithGuest("r6-two")
		// Core's `greet2` is a companion (on); the plugin's is an attachment
		// (off). Core's being enabled says nothing about the plugin's — they
		// are two identities.
		await publishActionSpec("core:spec/test-greet2", { key: "greet2" })
		await publishActionSpec("acme:spec/greet2", { key: "greet2" })

		const refused = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "acme:spec/greet2#greet2",
				specSlug: "acme:spec/greet2",
				scope: "session"
			},
			noopEmit
		)
		expect(refused.error).toMatch(
			/'greet2' from 'acme:spec\/greet2' is not enabled for this session/
		)
		// The picker offers only what the bind would take (S8): the
		// declarer, while its action is enabled.
		const picker = await sessionsFunctionCandidatesHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, subject: "acme:spec/greet2#greet2" },
			noopEmit
		)
		expect(picker.candidates).toEqual([])
		const corePicker = await sessionsFunctionCandidatesHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, subject: "core:spec/test-greet2#greet2" },
			noopEmit
		)
		expect(corePicker.candidates).toEqual(["core:spec/test-greet2"])
		expect(corePicker.resolved).toBe("core:spec/test-greet2")

		// The companion's own binds.
		const ok = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/test-greet2#greet2",
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
				subject: "acme:spec/greet2#greet2",
				specSlug: "acme:spec/greet2",
				scope: "session"
			},
			noopEmit
		)
		expect(now.error).toBeUndefined()
		const widened = await sessionsFunctionCandidatesHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, subject: "acme:spec/greet2#greet2" },
			noopEmit
		)
		expect(widened.candidates).toEqual(["acme:spec/greet2"])
		expect(widened.resolved).toBe("acme:spec/greet2")
	}, 60_000)
})

describe("sessions:fireAction announces its run (R-19)", () => {
	test("runSpec is built with the socket's io, so the status relay can reach sessions:runStatus and the live row", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { owner, session } = await sessionWithGuest("announce")

		await publishActionSpec("core:spec/test-announce-action", {
			key: "wink"
		})

		statusRelayHooks.ioSeen.length = 0
		const socket = fakeSocket(owner.id)
		const res = await sessionsFireActionHandler.handler(
			socket,
			{
				sessionId: session.id,
				action: "core:spec/test-announce-action#wink"
			},
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/not yours to use|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-announce-action")

		// Both runs the fire makes — the recompute that opens the turn and
		// the action's own — were relayed with the caller's `io`, never
		// `undefined`, which is what silently dropped every status this
		// route ever set.
		expect(statusRelayHooks.ioSeen).toEqual([socket.io, socket.io])
	}, 60_000)
})

describe("enabled-when (U5e)", () => {
	const ADVENTURE = "core:genre/adventure"
	const LOCATION = "core:slot/location@1"
	const LOOK_REASON = "Set a location first — Look describes where you are."

	/** An Adventure session with an owner — the genre whose world has a location. */
	async function adventureSession(tag: string) {
		const schema = await import("$lib/server/db/schema")
		const owner = await makeUser(`${tag}-owner`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: ADVENTURE })
			.returning()
		return { owner, session }
	}
	const setLocation = async (userId: number, sessionId: number, value: string | null) => {
		const { stateSet } = await import("./state")
		await stateSet.handler(
			fakeSocket(userId),
			{ sessionId, owner: { kind: "session", id: sessionId }, slotId: LOCATION, value },
			noopEmit
		)
	}
	const listComposer = async (userId: number, sessionId: number) => {
		const { sessionsActionsHandler } = await import("./sessions")
		const res = await sessionsActionsHandler.handler(
			fakeSocket(userId),
			{ sessionId },
			noopEmit
		)
		return all(res.venues.composer)
	}
	const fire = async (
		userId: number,
		sessionId: number,
		action: string,
		messageId?: number
	) => {
		const { sessionsFireActionHandler } = await import("./sessions")
		return sessionsFireActionHandler.handler(
			fakeSocket(userId),
			{ sessionId, action, ...(messageId != null ? { messageId } : {}) },
			noopEmit
		)
	}

	test("a contributed predicate over state.world.location: grey with its reason while empty, enabled after state:set; the door refuses with the sentence and admits after", async () => {
		const { owner, session } = await adventureSession("when")
		await publishActionSpec(
			"core:spec/test-when-survey",
			{
				key: "survey",
				enabledWhen: {
					on: "state.world.location",
					truthy: true,
					reason: { en: "Name a place to survey first." }
				}
			},
			{ genre: "adventure" }
		)

		const before = (await listComposer(owner.id, session.id)).find(
			(a) => a.key === "survey"
		)
		expect(before).toMatchObject({
			canAct: true,
			enabled: false,
			reason: { i18n: { en: "Name a place to survey first." } }
		})
		expect(before?.itemPredicates).toBeUndefined()
		// Listed — grey, never dropped (F38).
		expect(before?.venue).toBe("composer")

		const refused = await fire(owner.id, session.id, "core:spec/test-when-survey#survey")
		expect(refused.error).toBe("Name a place to survey first.")
		expect(await runsOf(session.id)).not.toContain("core:spec/test-when-survey")

		await setLocation(owner.id, session.id, "The Vale")
		const after = (await listComposer(owner.id, session.id)).find(
			(a) => a.key === "survey"
		)
		expect(after).toMatchObject({ enabled: true })
		expect(after?.reason).toBeUndefined()

		const admitted = await fire(owner.id, session.id, "core:spec/test-when-survey#survey")
		expect(admitted.error ?? "").not.toBe("Name a place to survey first.")
		expect(await runsOf(session.id)).toContain("core:spec/test-when-survey")

		// Cleared again: grey again, refused again — the verdict is the values', not a latch.
		await setLocation(owner.id, session.id, null)
		expect(
			(await listComposer(owner.id, session.id)).find((a) => a.key === "survey")?.enabled
		).toBe(false)
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-survey#survey")).error
		).toBe("Name a place to survey first.")
	}, 60_000)

	test("the genre's default applies to an action declaring nothing; the action's own beats it (an explicit [] opts out); a session binding override beats both; clearing restores", async () => {
		// A fixture genre with defaults keyed by identity (plans/31 V2; review
		// W8: no shipped genre declares one), and three declarers of `look`
		// under it: one saying nothing (the default's), one with its own
		// predicate, one opting out of the default named for it.
		const FIXTURE = "core:genre/test-when"
		const LOOK_DEFAULT = { on: "state.world.location", truthy: true, reason: { en: LOOK_REASON } }
		const fixture = await publishFixtureGenre(FIXTURE, {
			"core:spec/test-when-default-look#look": LOOK_DEFAULT,
			"core:spec/test-when-optout-look#look": LOOK_DEFAULT
		})
		const schema = await import("$lib/server/db/schema")
		const owner = await makeUser("when-order-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: FIXTURE })
			.returning()
		// Three declarers of one key are three identities under three slash
		// names (V2: one slash name means one action).
		await publishActionSpec(
			"core:spec/test-when-default-look",
			{ key: "look", slash: "look-default" },
			{ genre: fixture }
		)
		await publishActionSpec(
			"core:spec/test-when-look",
			{
				key: "look",
				slash: "look-own",
				enabledWhen: {
					on: "state.world.location",
					equals: "The Storm",
					reason: { en: "Only in the storm." }
				}
			},
			{ genre: fixture }
		)
		await publishActionSpec(
			"core:spec/test-when-optout-look",
			{ key: "look", slash: "look-optout", enabledWhen: [] },
			{ genre: fixture }
		)

		const listed = await listComposer(owner.id, session.id)
		expect(listed.find((a) => a.specSlug === "core:spec/test-when-default-look")).toMatchObject({
			enabled: false,
			reason: { i18n: { en: LOOK_REASON } }
		})
		expect(listed.find((a) => a.specSlug === "core:spec/test-when-look")).toMatchObject({
			enabled: false,
			reason: { i18n: { en: "Only in the storm." } }
		})
		expect(listed.find((a) => a.specSlug === "core:spec/test-when-optout-look")).toMatchObject({
			enabled: true
		})
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-default-look#look")).error
		).toBe(LOOK_REASON)
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-look#look")).error
		).toBe("Only in the storm.")
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-optout-look#look")).error ?? ""
		).not.toMatch(/Only in the storm|Set a location/)

		// The session's override, riding the binding row for ONE action
		// (V2): beats that declaration's own predicate and the genre's
		// default for it, and touches no other declarer of the key.
		const { sessionsBindFunctionHandler } = await import("./sessions")
		const bound = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/test-when-look#look",
				specSlug: "core:spec/test-when-look",
				scope: "session",
				enabledWhen: {
					on: "state.world.location",
					equals: "Nowhere",
					reason: { en: "Go to Nowhere first." }
				}
			},
			noopEmit
		)
		expect(bound.error).toBeUndefined()
		const overridden = await listComposer(owner.id, session.id)
		expect(overridden.find((a) => a.specSlug === "core:spec/test-when-look")).toMatchObject({
			enabled: false,
			reason: { i18n: { en: "Go to Nowhere first." } }
		})
		expect(overridden.find((a) => a.specSlug === "core:spec/test-when-default-look")).toMatchObject({
			enabled: false,
			reason: { i18n: { en: LOOK_REASON } }
		})
		expect(overridden.find((a) => a.specSlug === "core:spec/test-when-optout-look")).toMatchObject({
			enabled: true
		})
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-look#look")).error
		).toBe("Go to Nowhere first.")
		expect(
			(await fire(owner.id, session.id, "core:spec/test-when-default-look#look")).error
		).toBe(LOOK_REASON)
		await setLocation(owner.id, session.id, "Nowhere")
		expect(
			(await listComposer(owner.id, session.id)).find(
				(a) => a.specSlug === "core:spec/test-when-look"
			)?.enabled
		).toBe(true)

		// An override that is not a predicate is refused with the SDK's sentence.
		const bad = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/test-when-look#look",
				specSlug: "core:spec/test-when-look",
				scope: "session",
				enabledWhen: { on: "$.state.x", truthy: true, reason: { en: "r" } }
			},
			noopEmit
		)
		expect(bad.error).toMatch(/reads as a port reference/)
		// …and an override with nothing to ride on.
		const bare = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/test-when-look#look",
				specSlug: null,
				scope: "session",
				enabledWhen: { on: "state.world.location", truthy: true, reason: { en: "r" } }
			},
			noopEmit
		)
		expect(bare.error).toMatch(/rides the session's binding/)
		// …and one on the primary turn, which has no button to grey.
		const onEvent = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:event/message-respond@1",
				specSlug: "core:spec/respond",
				scope: "session",
				enabledWhen: { on: "state.world.location", truthy: true, reason: { en: "r" } }
			},
			noopEmit
		)
		expect(onEvent.error).toMatch(/an action's — a turn's event has no button/)

		// Clearing the override restores the layers beneath: the default's
		// row the genre default (now satisfied — location is set), the
		// declarer's its own, the opt-out nothing.
		await setLocation(owner.id, session.id, "The Vale")
		const cleared = await sessionsBindFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				subject: "core:spec/test-when-look#look",
				specSlug: "core:spec/test-when-look",
				scope: "session",
				enabledWhen: null
			},
			noopEmit
		)
		expect(cleared.error).toBeUndefined()
		const restored = await listComposer(owner.id, session.id)
		expect(restored.find((a) => a.specSlug === "core:spec/test-when-default-look")).toMatchObject({
			enabled: true
		})
		expect(restored.find((a) => a.specSlug === "core:spec/test-when-look")).toMatchObject({
			enabled: false,
			reason: { i18n: { en: "Only in the storm." } }
		})
		expect(restored.find((a) => a.specSlug === "core:spec/test-when-optout-look")).toMatchObject({
			enabled: true
		})
		// The binding itself still stands: the override left, the spec stayed.
		const [row] = await testDb
			.select({
				enabledWhen: schema.pipelineBindings.enabledWhen,
				subject: schema.pipelineBindings.subject
			})
			.from(schema.pipelineBindings)
			.where(eq(schema.pipelineBindings.scopeId, session.id))
		expect(row).toEqual({ enabledWhen: null, subject: "core:spec/test-when-look#look" })
	}, 60_000)

	test("swipe on a non-newest row is refused at the verb's door with the notNewest reason; the message venue carries the item predicates", async () => {
		const { sessionMessagesSwipeRightHandler, sessionsActionsHandler } =
			await import("./sessions")
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithGuest("when-swipe")
		const reply = async () =>
			(
				await testDb
					.insert(schema.sessionMessages)
					.values({
						sessionId: session.id,
						role: "assistant",
						content: "a line",
						isNarratorResponse: true,
						userId: owner.id
					})
					.returning()
			)[0]!
		const older = await reply()
		await reply()

		const refused = await sessionMessagesSwipeRightHandler.handler(
			fakeSocket(owner.id),
			{ id: older.id },
			noopEmit
		)
		expect(refused.error).toBe(CORE_VERB_REASONS.notNewest.en)

		// The listing hands the client what it needs to grey the row itself.
		const res = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		const swipe = all(res.venues.message).find((a) => a.key === "swipe")!
		expect(swipe.enabled).toBe(true)
		const paths = (a: { itemPredicates?: { on: string }[] }) => a.itemPredicates?.map((p) => p.on)
		expect(paths(swipe)).toEqual([
			"item.isNewest",
			"item.role",
			"item.hasSwipes"
		])
		const retry = all(res.venues.message).find((a) => a.key === "retry")!
		expect(paths(retry)).toEqual([
			"item.isNewest",
			"item.role",
			"item.greeting",
			"item.hidden"
		])
		// Stop declares nothing; every other verb waited for the session and passed.
		for (const a of all(res.venues.message)) expect(a.enabled, a.key).toBe(true)
		expect(all(res.venues.message).find((a) => a.key === "stop")?.itemPredicates).toBeUndefined()
	}, 60_000)

	test("session.generating greys every verb but stop while a run is live, and lifts when it ends", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const { owner, session } = await sessionWithGuest("when-busy")
		await publishActionSpec("core:spec/test-when-quiet", {
			key: "quiet",
			enabledWhen: {
				on: "session.generating",
				equals: false,
				reason: { en: "Let the reply land first." }
			}
		})

		const handle = runRegistry.start({
			runId: `when-busy-${session.id}`,
			userId: owner.id,
			sessionId: session.id,
			specId: "core:spec/test",
			kind: "action"
		})
		try {
			const busy = await sessionsActionsHandler.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id },
				noopEmit
			)
			// Core's verbs: every one but stop declares the busy rule. (A
			// contributed message action from an earlier test declares none
			// of its own, and is not held to one it did not write.)
			for (const a of all(busy.venues.message).filter((a) => a.specSlug === "core")) {
				if (a.key === "stop") expect(a.enabled).toBe(true)
				else
					expect(a, a.key).toMatchObject({
						enabled: false,
						reason: { i18n: CORE_VERB_REASONS.generating }
					})
			}
			expect(all(busy.venues.composer).find((a) => a.key === "quiet")).toMatchObject({
				enabled: false,
				reason: { i18n: { en: "Let the reply land first." } }
			})
			// The door, too — a hand-made fire while a run is live.
			const { sessionsFireActionHandler } = await import("./sessions")
			const refused = await sessionsFireActionHandler.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id, action: "core:spec/test-when-quiet#quiet" },
				noopEmit
			)
			expect(refused.error).toBe("Let the reply land first.")
		} finally {
			runRegistry.finish(handle.runId)
		}
		const quiet = await sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		for (const a of all(quiet.venues.message)) expect(a.enabled, a.key).toBe(true)
		expect(all(quiet.venues.composer).find((a) => a.key === "quiet")?.enabled).toBe(true)
	}, 60_000)
})

describe("enabled-when — the review's follow-ups (2026-09-17)", () => {
	const reply = async (sessionId: number, userId: number, over: Record<string, unknown> = {}) => {
		const schema = await import("$lib/server/db/schema")
		return (
			await testDb
				.insert(schema.sessionMessages)
				.values({
					sessionId,
					role: "assistant",
					content: "a line",
					isNarratorResponse: true,
					userId,
					...over
				})
				.returning()
		)[0]!
	}

	test("the floors ask their door (W2): editing a hidden row is refused with 'unhide it first'; branching while a run is live is refused with the busy sentence", async () => {
		const { sessionMessagesUpdateHandler, sessionsBranchHandler } = await import("./sessions")
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const { owner, session } = await sessionWithGuest("when-floors")
		const hidden = await reply(session.id, owner.id, { isHidden: true })

		const edit = await sessionMessagesUpdateHandler.handler(
			fakeSocket(owner.id),
			{ id: hidden.id, content: "rewritten" },
			noopEmit
		)
		expect(edit.error).toBe(CORE_VERB_REASONS.hidden.en)
		// Unhiding it is the hide verb's, which has no such rule: admitted.
		const unhide = await sessionMessagesUpdateHandler.handler(
			fakeSocket(owner.id),
			{ id: hidden.id, isHidden: false },
			noopEmit
		)
		expect(unhide.error).toBeUndefined()
		const edited = await sessionMessagesUpdateHandler.handler(
			fakeSocket(owner.id),
			{ id: hidden.id, content: "rewritten" },
			noopEmit
		)
		expect(edited.error).toBeUndefined()

		const handle = runRegistry.start({
			runId: `when-floors-${session.id}`,
			userId: owner.id,
			sessionId: session.id,
			specId: "core:spec/test",
			kind: "action"
		})
		try {
			const branch = await sessionsBranchHandler.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id, messageId: hidden.id, title: "fork" },
				noopEmit
			)
			expect(branch.error).toBe(CORE_VERB_REASONS.generating.en)
			const busyEdit = await sessionMessagesUpdateHandler.handler(
				fakeSocket(owner.id),
				{ id: hidden.id, content: "again" },
				noopEmit
			)
			expect(busyEdit.error).toBe(CORE_VERB_REASONS.generating.en)
		} finally {
			runRegistry.finish(handle.runId)
		}
		const branch = await sessionsBranchHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, messageId: hidden.id, title: "fork" },
			noopEmit
		)
		expect(branch.error).toBeUndefined()
	}, 60_000)

	test("a press naming a row of another session is refused at the door; an item.* predicate with no row to judge is refused with its reason (W4)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { enablementVerdict } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const { owner, session } = await sessionWithGuest("when-w4")
		const other = await sessionWithGuest("when-w4-other")
		const theirs = await reply(other.session.id, other.owner.id)
		await publishActionSpec("core:spec/test-when-annotate", {
			key: "annotate",
			venue: [{ kind: "composer" }, { kind: "message" }],
			enabledWhen: { on: "item.hidden", equals: false, reason: { en: "Not on a hidden line." } }
		})

		// The door itself, with the verdict's own reading.
		const foreign = await enablementVerdict(
			testDb as any,
			session.id,
			CHAT,
			{ userId: owner.id },
			{ specSlug: "core:spec/test-annotate", key: "annotate", enabledWhen: [] },
			theirs.id
		)
		expect(foreign).toMatchObject({
			enabled: false,
			reason: { i18n: { en: "That message is not part of this session." } }
		})
		const noRow = await enablementVerdict(
			testDb as any,
			session.id,
			CHAT,
			{ userId: owner.id },
			{
				specSlug: "core:spec/test-annotate",
				key: "annotate",
				enabledWhen: [{ on: "item.hidden", equals: false, reason: { en: "Not on a hidden line." } }]
			}
		)
		expect(noRow).toMatchObject({
			enabled: false,
			reason: { i18n: { en: "Not on a hidden line." } },
			itemPredicates: []
		})

		// …and over the real handler: a composer press names no row.
		const pressed = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, action: "core:spec/test-when-annotate#annotate" },
			noopEmit
		)
		expect(pressed.error).toBe("Not on a hidden line.")
		const onForeign = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				action: "core:spec/test-when-annotate#annotate",
				messageId: theirs.id
			},
			noopEmit
		)
		expect(onForeign.error).toBe("That message is not part of this session.")
		// A row of this session admits it.
		const mine = await reply(session.id, owner.id)
		const onMine = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				action: "core:spec/test-when-annotate#annotate",
				messageId: mine.id
			},
			noopEmit
		)
		expect(onMine.error ?? "").not.toMatch(/Not on a hidden line|not part of this session/)
		expect(await runsOf(session.id)).toContain("core:spec/test-when-annotate")
	}, 60_000)

	test("a root pushes sessions:actions to each member once at its start (retry grey, generating) and once at its end (retry enabled) — never per child (C1, W-A1)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const { owner, guest, session } = await sessionWithGuest("when-push")
		await reply(session.id, owner.id)
		await publishActionSpec("core:spec/test-when-nudge", { key: "nudge" })
		const { io, emitted } = recordingIo([owner.id, guest.id], session.id)
		const socket = { user: { id: owner.id, isAdmin: false }, io } as any

		const res = await sessionsFireActionHandler.handler(
			socket,
			{ sessionId: session.id, action: "core:spec/test-when-nudge#nudge" },
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/not yours|Session not found/)
		expect(await runsOf(session.id)).toContain("core:spec/test-when-nudge")

		const pushes = emitted.filter((e) => e.event === "sessions:actions")
		// Two per member — the rise and the fall — each their own list, in order.
		for (const room of [`socket-${owner.id}`, `socket-${guest.id}`]) {
			const mine = pushes.filter((p) => p.room === room)
			expect(mine, room).toHaveLength(2)
			const retryOf = (push: (typeof mine)[number]) =>
				all(push.payload.venues.message).find((a: any) => a.key === "retry")
			expect(mine[0]!.payload.sessionId).toBe(session.id)
			expect(retryOf(mine[0]!)).toMatchObject({
				enabled: false,
				reason: { i18n: CORE_VERB_REASONS.generating }
			})
			expect(retryOf(mine[1]!)).toMatchObject({ enabled: true })
			expect(retryOf(mine[1]!).reason).toBeUndefined()
		}
		// The owner's list says the owner may act; the guest's says a guest may see.
		const forGuest = pushes.filter((p) => p.room === `socket-${guest.id}`).pop()!
		expect(all(forGuest.payload.venues.composer).find((a: any) => a.key === "nudge")?.canAct).toBe(false)
	}, 60_000)

	test("a member whose only tab is on another session is sent nothing, and no list is built for them (W-A4)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { __actionsPushBuildsForTests } = await import("$lib/server/sessions/actionsPush")
		const { owner, guest, session } = await sessionWithGuest("when-scope")
		const elsewhere = await sessionWithGuest("when-scope-elsewhere")
		await publishActionSpec("core:spec/test-when-wave2", { key: "wave2" })
		// The owner watches this session; the guest's socket watches another.
		const { io, emitted } = recordingIo([owner.id], session.id, {
			[guest.id]: elsewhere.session.id
		})
		const before = __actionsPushBuildsForTests()
		const res = await sessionsFireActionHandler.handler(
			{ user: { id: owner.id, isAdmin: false }, io } as any,
			{ sessionId: session.id, action: "core:spec/test-when-wave2#wave2" },
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/not yours|Session not found/)
		const pushes = emitted.filter((e) => e.event === "sessions:actions")
		expect(pushes.map((p) => p.room)).toEqual([`socket-${owner.id}`, `socket-${owner.id}`])
		// Two lists built — the owner's rise and fall — and none for the guest.
		expect(__actionsPushBuildsForTests() - before).toBe(2)

		// Nobody watching the session at all: the roster is not even read
		// (the interest rule — a socket that wants nothing costs no query),
		// and nothing is built.
		const { pushSessionActions } = await import("$lib/server/sessions/actionsPush")
		const nobody = recordingIo([], session.id, { [guest.id]: elsewhere.session.id })
		const roster = vi.spyOn(testDb.query.sessionGuests, "findMany")
		const quiet = __actionsPushBuildsForTests()
		try {
			await pushSessionActions(nobody.io, session.id)
			expect(roster).not.toHaveBeenCalled()
		} finally {
			roster.mockRestore()
		}
		expect(__actionsPushBuildsForTests() - quiet).toBe(0)
		expect(nobody.emitted).toEqual([])
	}, 60_000)

	test("a client's own request made while a push is in flight is answered after it, on the same chain (pass 3)", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const { pushSessionActions } = await import("$lib/server/sessions/actionsPush")
		const { owner, session } = await sessionWithGuest("when-chain")
		await reply(session.id, owner.id)
		const { io, emitted } = recordingIo([owner.id], session.id)
		const ownEmit = (event: string, payload: any) =>
			emitted.push({ room: "caller", event, payload })

		// The end push goes out; the request lands while it is still building.
		const push = pushSessionActions(io, session.id)
		const reply2 = sessionsActionsHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			ownEmit
		)
		await Promise.all([push, reply2])
		const events = emitted.filter((e) => e.event === "sessions:actions").map((e) => e.room)
		expect(events).toEqual([`socket-${owner.id}`, "caller"])
		expect(all((await reply2).venues.message).find((a: any) => a.key === "retry")).toMatchObject({
			enabled: true
		})
	}, 60_000)

	test("the list follows a genre field write and a membership change (W-A5)", async () => {
		const { sessionsUpdateHandler, sessionsAddGuestHandler, sessionsRemoveGuestHandler } =
			await import("./sessions")
		const { owner, guest, session } = await sessionWithGuest("when-moves")
		const { io, emitted } = recordingIo([owner.id, guest.id], session.id)
		const socket = { user: { id: owner.id, isAdmin: false }, io } as any
		const count = () => emitted.filter((e) => e.event === "sessions:actions").length

		// A genre field: one push per member.
		let before = count()
		const updated = await sessionsUpdateHandler.handler(
			socket,
			{ session: { id: session.id, genreFields: { tone: "grim" } } } as any,
			noopEmit
		)
		expect((updated as any).error).toBeUndefined()
		expect(count() - before).toBe(2)
		// A write that names no field and no member moves nothing.
		before = count()
		await sessionsUpdateHandler.handler(
			socket,
			{ session: { id: session.id, name: "renamed" } } as any,
			noopEmit
		)
		expect(count() - before).toBe(0)

		// A member joins: the owner, the guest and the newcomer each get a list.
		const newcomer = await makeUser("when-moves-newcomer")
		const { io: io3, emitted: emitted3 } = recordingIo([owner.id, guest.id, newcomer.id], session.id)
		const added = await sessionsAddGuestHandler.handler(
			{ user: { id: owner.id, isAdmin: false }, io: io3 } as any,
			{ sessionId: session.id, guestUserId: newcomer.id },
			noopEmit
		)
		expect((added as any).error).toBeUndefined()
		expect(
			emitted3.filter((e) => e.event === "sessions:actions").map((p) => p.room).sort()
		).toEqual([`socket-${guest.id}`, `socket-${newcomer.id}`, `socket-${owner.id}`].sort())

		// …and leaves: the ones who remain relist.
		const { io: io4, emitted: emitted4 } = recordingIo([owner.id, guest.id, newcomer.id], session.id)
		const removed = await sessionsRemoveGuestHandler.handler(
			{ user: { id: owner.id, isAdmin: false }, io: io4 } as any,
			{ sessionId: session.id, guestUserId: newcomer.id },
			noopEmit
		)
		expect((removed as any).error).toBeUndefined()
		expect(
			emitted4.filter((e) => e.event === "sessions:actions").map((p) => p.room).sort()
		).toEqual([`socket-${guest.id}`, `socket-${owner.id}`].sort())
	}, 60_000)
})

// ⚠ Nothing after this point: the next block deliberately leaves the
// install's slash names colliding, to prove `assertInstallSlashNamesFree`
// catches it (S2) — every later `publishActionSpec` in this file would
// inherit that broken state and fail to publish at all.
describe("one slash name means one action across the install (plans/31 V2)", () => {
	test("publishing a second spec claiming a name is refused — for another key, and for the same key alike", async () => {
		await publishActionSpec("core:spec/test-slash-one", {
			key: "conjure",
			slash: "cast"
		})
		await expect(
			publishActionSpec("core:spec/test-slash-two", {
				key: "hex",
				slash: "cast"
			})
		).rejects.toThrow(/'\/cast' is claimed twice for genre 'core:genre\/chat'/)

		// Until V2 the same *function* under one name was an alternative a
		// binding selected among; the function is gone, and two specs
		// declaring one key are two identities a palette could not tell apart.
		await expect(
			publishActionSpec("core:spec/test-slash-three", {
				key: "conjure",
				slash: "cast"
			})
		).rejects.toThrow(/'\/cast' is claimed twice.*by 'core:spec\/test-slash-one' for 'conjure' and by 'core:spec\/test-slash-three' for 'conjure'/)
	}, 60_000)

	test("a core spec cannot shadow a core verb's slash (S1)", async () => {
		await expect(
			publishActionSpec("core:spec/test-shadow-retry", {
				key: "redo",
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
		await publishActionSpec(A, { key: "alpha", slash: "swap-x" })
		await publishActionSpec(B, { key: "beta", slash: "swap-y" })

		// Release N+1 swaps them. One at a time, A' meets B's old claim.
		await expect(
			publishActionSpec(
				A,
				{ key: "alpha", slash: "swap-y" },
				{ version: "1.1.0" }
			)
		).rejects.toThrow(/'\/swap-y' is claimed twice/)

		// As a batch — each publish excluding its batch-mates — both land…
		const batch = new Set([A, B])
		await expect(
			publishActionSpec(
				A,
				{ key: "alpha", slash: "swap-y" },
				{ version: "1.1.0", batch }
			)
		).resolves.toMatchObject({ written: true })
		await expect(
			publishActionSpec(
				B,
				{ key: "beta", slash: "swap-x" },
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
				{ key: "gamma", slash: "swap-y" },
				{ batch: new Set([C, A]) }
			)
		).resolves.toMatchObject({ written: true })
		await expect(assertInstallSlashNamesFree(testDb as any)).rejects.toThrow(
			/the install's published specs collide on a slash name: '\/swap-y' is claimed twice/
		)
	}, 60_000)
})

/**
 * 18. **Retake** (lair pass R2, 2026-09-28): Regenerate the last turn is a
 *     turn control only a genre that declares it offers. Chat and Guide list
 *     exactly the turn controls and message verbs they did — the row
 *     regenerate at both venues, no retake — and the Lair shows ONE
 *     Regenerate in the composer's extra venue (retake), its row regenerate
 *     staying on the message venue. Retake's "don't ask again" is core's one
 *     annex field, settable by the owner at the widget venue in every genre.
 */
describe("R2 · retake in the listing", () => {
	const keysOf = (bucket: { primary: any[]; overflow: any[] }) =>
		[...bucket.primary, ...bucket.overflow]
			.filter((a) => a.specSlug === "core")
			.map((a) => a.key)
			.sort()

	let made = 0
	async function listing(genreId: string) {
		const schema = await import("$lib/server/db/schema")
		const owner = await makeUser(`retake-listing-${++made}`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId })
			.returning()
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		return listSessionActions(testDb as any, session.id, { userId: owner.id })
	}

	test("Chat and Guide: unchanged — no retake, the row regenerate at both venues", async () => {
		const chat = await listing("core:genre/chat")
		expect(keysOf(chat.extra)).toEqual(["advance", "pick", "retry"])
		expect(keysOf(chat.message)).toContain("retry")
		const guide = await listing("core:genre/guide")
		expect(keysOf(guide.extra)).toEqual(["retry"])
		expect(keysOf(guide.message)).toContain("retry")
		for (const v of [chat, guide])
			for (const bucket of Object.values(v))
				expect(keysOf(bucket as any)).not.toContain("retake")
	})

	test("the Lair: one Regenerate in the extra venue — retake — and the row regenerate on messages", async () => {
		const lair = await listing("core:genre/lair")
		const extra = [...lair.extra.primary, ...lair.extra.overflow]
		expect(extra.filter((a) => a.name === "Regenerate").map((a) => `${a.specSlug}#${a.key}`)).toEqual([
			"core#retake"
		])
		expect(keysOf(lair.extra)).toEqual(["advance", "narrate", "pick", "retake"])
		expect(keysOf(lair.message)).toContain("retry")
		const retake = extra.find((a) => a.key === "retake")!
		expect(retake.slash).toBe("retake")
		expect(retake.audience.act).toEqual(["owner"])
	})

	test("retake's \"don't ask again\" is core's annex field, the owner's to set", async () => {
		for (const genreId of ["core:genre/chat", "core:genre/lair"]) {
			const v = await listing(genreId)
			const widget = [...v.widget.primary, ...v.widget.overflow]
			const field = widget.find((a) => a.specSlug === "core:annex" && a.key === "retake-quietly")
			expect(field, genreId).toBeTruthy()
			expect(field!.audience.act).toEqual(["owner"])
		}
	})
})
