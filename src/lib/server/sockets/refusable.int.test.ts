/**
 * A real failed query through a `refusable` handler and the socket guard's
 * payload rule (`payloadWithoutQueryText`, run on every packet by
 * `queryTextGuard.ts`): the person hears a sentence, never the SQL or a value
 * the query wrote.
 *
 * drizzle-orm (0.44+) re-throws every failed query with the message
 * `Failed query: <sql>\nparams: <values>`. Forwarded whole — as ~85 handlers
 * forward a caught `e.message` — an insert of a message or a lore entry would
 * send that content back out over the socket.
 */
import { beforeAll, describe, expect, test } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	isFailedQuery,
	isUniqueViolation,
	payloadWithoutQueryText,
	QUERY_FAILED_SENTENCE
} from "$lib/server/db/errors"
import { refusable } from "./refusable"

const SECRET = "SECRET-PARAM-a7f3"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await db.insert(schema.users).values({ username: SECRET })
}, 60_000)

/** The same username again: a unique violation carrying the value. */
const clash = () => db.insert(schema.users).values({ username: SECRET })

/** The error `clash` rejects with, as a handler's `catch` would hold it. */
async function clashError(): Promise<Error> {
	try {
		await clash()
	} catch (e) {
		return e as Error
	}
	throw new Error("the insert was expected to fail")
}

function collector() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => {
			events.push({ event, data })
		}
	}
}

describe("refusable, on a real failed query", () => {
	test("an untranslated one answers with the fallback and re-throws the whole error", async () => {
		const handler = refusable(
			"test:clash",
			async () => {
				await clash()
			},
			"That could not be saved."
		)
		const c = collector()
		const thrown = await handler
			.handler({} as any, {}, c.emit)
			.catch((e: unknown) => e)

		// The server log still gets everything: the re-throw is the wrapper.
		expect(isFailedQuery(thrown)).toBe(true)
		expect(String((thrown as Error).message)).toContain(SECRET)

		expect(c.events).toEqual([
			{ event: "test:clash:error", data: { error: "That could not be saved." } }
		])
		expect(JSON.stringify(c.events)).not.toMatch(
			new RegExp(`Failed query|insert into|${SECRET}`, "i")
		)
	}, 60_000)

	test("a translated one says the translation, read off the driver error", async () => {
		const handler = refusable(
			"test:clash",
			async () => {
				await clash()
			},
			"That could not be saved.",
			(e) => (isUniqueViolation(e) ? "That name is taken." : undefined)
		)
		const c = collector()
		await expect(handler.handler({} as any, {}, c.emit)).rejects.toThrow()
		expect(c.events[0].data).toEqual({ error: "That name is taken." })
	}, 60_000)
})

describe("the socket guard's payload rule, on a real failed query", () => {
	test("a handler that forwards e.message sends the plain sentence instead", async () => {
		const e = await clashError()
		const sent = payloadWithoutQueryText("characters:create:error", {
			error: e.message || "Failed to create character."
		})
		expect(sent).toEqual({ error: QUERY_FAILED_SENTENCE })
	}, 60_000)

	test("an import's per-item errors keep their names and lose the query", async () => {
		const e = await clashError()
		const sent = payloadWithoutQueryText("import:sillytavern:execute", {
			success: true,
			errors: [`Character "Ada": ${e.message}`]
		})
		expect(sent.errors).toEqual([`Character "Ada": ${QUERY_FAILED_SENTENCE}`])
		expect(JSON.stringify(sent)).not.toContain(SECRET)
	}, 60_000)
})
