/**
 * A failed activity says what happened — to whoever is allowed to be told.
 *
 * ## The bug this pins
 *
 * `activityStore.getFor` serves a non-admin THEIR OWN activities, and
 * `scenes.ts`, `summarize.ts` and `narrativeGraph.ts` each wrote a caught
 * `err.message` straight into `errorMessage`. For an adapter failure that
 * message is the base URL and the model file path — `managedPreflight` fills
 * them in — so a non-admin who ran a summarize against a connection they were
 * never shown could read it out of the failure card.
 *
 * `sockets/activity.ts` runs the connection projection on every emit, but that
 * walk is key-shaped and `errorMessage` is free text: a name is a substring
 * there, not a field. So the fix is the one `persistGenerationErrorRow` already
 * uses — the sentence is composed without an identity, and the identity travels
 * beside it under `connection`, the key the walk removes.
 *
 * ## What these tests assert on
 *
 * The value that actually reaches the socket: every case drives
 * `registerActivityHandlers` with a fake socket and reads what `socket.emit`
 * was handed, so the whole chain (`getFor` → `redactConnections` → emit) is
 * under test rather than the object at the write site.
 */
import { afterEach, describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { registerActivityHandlers } from "./activity"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
import { DrizzleQueryError } from "drizzle-orm"
import { QUERY_FAILED_SENTENCE } from "$lib/server/db/errors"
import {
	ComposedError,
	connectionIdentity
} from "$lib/server/connections/visibility"

/**
 * Everything a service error can name, in one string: the base URL, the model
 * path on the administrator's disk, and a credential fragment.
 */
const SERVICE_TEXT =
	"KoboldCPP API error at http://192.168.1.5:5001: model " +
	"/home/admin/models/mythomax-q4.gguf not loaded (invalid API key " +
	"sk-real-secret-fragment)"

/** The connection the failure was about, as a row would spell it. */
const CONNECTION_ROW = {
	// Deliberately not a small number: the assertion below is a substring
	// search over the serialised record, and "42" occurs in an ISO timestamp.
	id: 987654,
	name: "Basement Rig",
	model: "/home/admin/models/mythomax-q4.gguf",
	type: "koboldcpp"
}

const NON_ADMIN = 7001
const ADMIN = 7002

/**
 * A connected client, exactly as `registerActivityHandlers` sees one.
 *
 * `emit` is captured rather than stubbed away because it is the thing under
 * test: the handler wraps it in `redactConnections`, and everything the store
 * broadcasts goes through that same wrapper.
 */
function connect(userId: number, isAdmin: boolean) {
	const emitted: Array<{ event: string; data: any }> = []
	const handlers = new Map<string, (arg?: any) => void>()
	const socket = {
		user: { id: userId, isAdmin },
		// `send()` in activity.ts reads this set as the interest gate before
		// emitting `activity:update`; every client here wants it.
		interest: new Set(["activity:update"]),
		emit: (event: string, data: any) => emitted.push({ event, data }),
		on: (event: string, fn: (arg?: any) => void) => {
			handlers.set(event, fn)
		}
	}
	registerActivityHandlers(socket)
	return {
		emitted,
		/** What an `activity:get` puts on the wire for this subject. */
		fetch(): any[] {
			emitted.length = 0
			handlers.get("activity:get")!()
			return emitted.at(-1)!.data.activities
		},
		/** The latest unsolicited push — the store's own broadcast. */
		lastPush(): any[] {
			return emitted.at(-1)!.data.activities
		},
		disconnect: () => handlers.get("disconnect")!()
	}
}

const started: string[] = []

function startScene(userId: number): string {
	const id = activityStore.startScene({
		userId,
		sceneId: 1234,
		lorebookId: 99,
		lorebookLabel: "Ambervale"
	})
	started.push(id)
	return id
}

function startSessionSummarize(userId: number): string {
	const id = activityStore.startSessionSummarize({
		userId,
		sessionId: 555,
		loreType: "world",
		lorebookId: 99
	})
	started.push(id)
	return id
}

const sockets: Array<{ disconnect: () => void }> = []

function client(userId: number, isAdmin: boolean) {
	const c = connect(userId, isAdmin)
	sockets.push(c)
	return c
}

afterEach(() => {
	// The store and its emitter set are module singletons — a leftover
	// subscriber would make the next test's broadcast fan out to it.
	for (const s of sockets.splice(0)) s.disconnect()
	for (const id of started.splice(0)) activityStore.remove(id)
})

describe("a failed activity", () => {
	test("names no connection to the non-admin whose own activity it is, and names one to an administrator", () => {
		const activityId = startScene(NON_ADMIN)
		const nonAdmin = client(NON_ADMIN, false)
		const admin = client(ADMIN, true)

		activityStore.updateScene(activityId, {
			status: "error",
			...activityError(new Error(SERVICE_TEXT))
		})

		const mine = nonAdmin.fetch()
		// The record really is theirs — otherwise this test would pass by
		// asserting on an empty list.
		expect(mine).toHaveLength(1)
		expect(mine[0].id).toBe(activityId)

		const serialised = JSON.stringify(mine)
		expect(serialised).not.toContain("sk-real-secret-fragment")
		expect(serialised).not.toContain("192.168.1.5")
		expect(serialised).not.toContain("mythomax-q4.gguf")
		expect(mine[0]).not.toHaveProperty("connection")

		// A redaction, not a blank: it still reads as a sentence that tells
		// somebody what to do next.
		expect(mine[0].errorMessage).toMatch(/service reported an error/i)
		expect(mine[0].errorMessage).toMatch(/administrator/i)

		// The administrator keeps the whole diagnostic, which is the half that
		// pre-redacting the stored string would have destroyed for everyone.
		const theirs = admin.fetch().find((a) => a.id === activityId)
		expect(theirs.connection.detail).toContain("sk-real-secret-fragment")
		expect(theirs.connection.detail).toContain("192.168.1.5")
	})

	test("is redacted on the store's own push, not only on a fetch", () => {
		const activityId = startScene(NON_ADMIN)
		const nonAdmin = client(NON_ADMIN, false)
		const admin = client(ADMIN, true)

		// The update broadcasts to every registered emitter. That push is a
		// separate serving from `activity:get` and was the one that used to
		// bypass the projection entirely.
		activityStore.updateScene(activityId, {
			status: "error",
			...activityError(new Error(SERVICE_TEXT))
		})

		const pushed = nonAdmin.lastPush().find((a) => a.id === activityId)
		expect(pushed).toBeDefined()
		expect(JSON.stringify(pushed)).not.toContain("192.168.1.5")
		expect(pushed).not.toHaveProperty("connection")

		expect(
			admin.lastPush().find((a) => a.id === activityId).connection.detail
		).toContain("192.168.1.5")
	})

	test("carries the same split on a session summarize, not just a scene", () => {
		const activityId = startSessionSummarize(NON_ADMIN)
		const nonAdmin = client(NON_ADMIN, false)
		const admin = client(ADMIN, true)

		activityStore.updateSessionSummarize(activityId, {
			status: "error",
			...activityError(new Error(SERVICE_TEXT))
		})

		const mine = nonAdmin.fetch().find((a) => a.id === activityId)
		expect(mine).toBeDefined()
		expect(JSON.stringify(mine)).not.toContain("mythomax-q4.gguf")
		expect(mine).not.toHaveProperty("connection")

		expect(
			admin.fetch().find((a) => a.id === activityId).connection.detail
		).toContain("mythomax-q4.gguf")
	})

	test("shows this codebase's own sentence verbatim, and the connection it was about to nobody else", () => {
		const activityId = startScene(NON_ADMIN)
		const nonAdmin = client(NON_ADMIN, false)
		const admin = client(ADMIN, true)

		const ours =
			"No connection on this instance can summarize. Nothing was changed."
		activityStore.updateScene(activityId, {
			status: "error",
			...activityError(
				new ComposedError(ours, connectionIdentity(CONNECTION_ROW))
			)
		})

		// Composed here, so it names nobody and is shown as written — a
		// non-admin gets the useful sentence rather than the opaque one.
		const mine = nonAdmin.fetch().find((a) => a.id === activityId)
		expect(mine.errorMessage).toBe(ours)
		expect(mine).not.toHaveProperty("connection")
		const serialised = JSON.stringify(mine)
		expect(serialised).not.toContain("Basement Rig")
		expect(serialised).not.toContain("koboldcpp")
		expect(serialised).not.toContain("987654")

		// The identity still travelled — beside the sentence, for the person
		// who has to go and fix the connection.
		const theirs = admin.fetch().find((a) => a.id === activityId)
		expect(theirs.errorMessage).toBe(ours)
		expect(theirs.connection).toMatchObject({
			id: 987654,
			name: "Basement Rig",
			type: "koboldcpp"
		})
	})

	test("does not reach a non-admin who is not its owner at all", () => {
		const activityId = startScene(ADMIN)
		const nonAdmin = client(NON_ADMIN, false)

		activityStore.updateScene(activityId, {
			status: "error",
			...activityError(new Error(SERVICE_TEXT))
		})

		expect(
			nonAdmin.fetch().find((a) => a.id === activityId)
		).toBeUndefined()
	})
})

describe("activityError", () => {
	test("moves an unmarked failure's words into the field and leaves a sentence behind", () => {
		const split = activityError(new Error(SERVICE_TEXT))
		expect(split.errorMessage).not.toContain("192.168.1.5")
		expect(split.connection!.detail).toBe(SERVICE_TEXT)
	})

	test("degrades a non-Error throw the same way rather than trusting it", () => {
		const split = activityError("http://192.168.1.5:5001 refused")
		expect(split.errorMessage).not.toContain("192.168.1.5")
		expect(split.connection!.detail).toBe("http://192.168.1.5:5001 refused")
	})

	test("carries no connection field when there is nothing to put in it", () => {
		// A `connection` bag that exists only to be empty makes the walk rebuild
		// the record for nothing, and tells an administrator less than the
		// sentence already did.
		expect(activityError(new Error(""))).not.toHaveProperty("connection")
		expect(
			activityError(new ComposedError("we said so"))
		).not.toHaveProperty("connection")
	})

	test("a failed query QUOTED in a message — a run's reason, a wrapper — reaches neither the card nor the detail", () => {
		// drizzle-orm 0.44+: a failed query's message is its SQL and every
		// value it bound. Only the top-level wrapper used to be caught.
		const quoted = new DrizzleQueryError(
			'insert into "lorebook_entries" ("content") values ($1)',
			["SECRET-PROSE-a2"],
			new Error("boom")
		).message
		for (const err of [
			new ComposedError(`summarize: ${quoted}`),
			new Error(`the save failed: ${quoted}`)
		]) {
			const split = activityError(err)
			expect(JSON.stringify(split)).not.toMatch(/SECRET-PROSE|Failed query|insert into/)
		}
		expect(activityError(new ComposedError(`summarize: ${quoted}`)).errorMessage).toBe(
			`summarize: ${QUERY_FAILED_SENTENCE}`
		)
	})
})

/**
 * The behavioural tests above prove the boundary for a record that was written
 * correctly. They cannot see the write SITES, which need a database, a pipeline
 * and a service to reach — so a revert to `errorMessage: err.message` would
 * leave every one of them green.
 *
 * This is the guard for that: in the three handlers that terminalise an
 * activity, a write that sets `status: "error"` may either go through
 * `activityError` or mention no caught error at all. The composed-sentence
 * writes (`failRun`'s string argument, and the "no new content" refusal) name
 * no error variable and so pass without an exemption list to keep in sync.
 */
describe("every activity error write", () => {
	const ROOT = resolve(__dirname, "../../../..")
	const FILES = [
		"src/lib/server/sockets/scenes.ts",
		"src/lib/server/sockets/summarize.ts",
		"src/lib/server/sockets/narrativeGraph.ts"
	]

	test("is composed by activityError, or names no caught error", () => {
		for (const file of FILES) {
			const lines = readFileSync(join(ROOT, file), "utf8").split("\n")
			const writes: Array<{ line: number; body: string }> = []
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim()
				if (trimmed !== 'status: "error",') continue
				const body: string[] = []
				for (let j = i; j < lines.length; j++) {
					body.push(lines[j])
					if (lines[j].trim() === "})") break
				}
				writes.push({ line: i + 1, body: body.join("\n") })
			}
			// A file that stopped matching would make every assertion below
			// vacuous, which is the failure mode this whole lane exists to
			// remove.
			expect(writes.length).toBeGreaterThan(0)
			for (const { line, body } of writes) {
				const usesHelper = body.includes("activityError(")
				const namesAnError = /\berr\b/.test(body)
				expect(
					usesHelper || !namesAnError,
					`${file}:${line} writes an activity error from a caught ` +
						`error without activityError — a service's words would ` +
						`reach a non-admin's own activity card.\n${body}`
				).toBe(true)
			}
		}
	})
})
