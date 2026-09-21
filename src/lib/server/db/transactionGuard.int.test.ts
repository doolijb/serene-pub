/**
 * The transaction guard: an outer-handle query inside its own transaction is a
 * thrown error, not a process-wide hang.
 *
 * The first case is the hazard itself, on a bare client, raced against a
 * timer: it is what every other case is measured against, and the reason
 * the guard throws rather than warns under test.
 */
import { describe, expect, test, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import {
	guardTransactions,
	TransactionDeadlockError
} from "$lib/server/db/transactionGuard"

vi.setConfig({ testTimeout: 30_000 })

/** The road, or the timer: a deadlocked promise never settles on its own. */
function within<T>(ms: number, road: Promise<T>): Promise<T | "hung"> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<"hung">((resolve) => {
		timer = setTimeout(() => resolve("hung"), ms)
	})
	return Promise.race([road, hung]).finally(() => clearTimeout(timer))
}

async function freshDb() {
	const client = new PGlite()
	const db = drizzle(client)
	await db.execute(sql`create table things (id serial primary key, name text)`)
	return { client, db }
}

describe("without the guard", () => {
	test("a select on the outer handle inside a transaction never returns", async () => {
		const { db } = await freshDb()
		// Not awaited past the race: the transaction below holds PGlite's
		// mutex for the rest of this client's life. The client is dropped
		// with the test.
		const road = db.transaction(async () => {
			await db.select().from(sql`things`)
		})
		road.catch(() => {})
		expect(await within(1_000, road)).toBe("hung")
	})
})

describe("with the guard, in throw mode", () => {
	test("a select on the outer handle inside a transaction is refused, naming the query and the transaction", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "throw")
		const road = db.transaction(async (tx) => {
			await tx.execute(sql`insert into things (name) values ('inside')`)
			await db.select().from(sql`things`)
		})
		await expect(within(5_000, road)).rejects.toBeInstanceOf(
			TransactionDeadlockError
		)
		await expect(road).rejects.toThrow(/OUTER database handle/)
		await expect(road).rejects.toThrow(/The transaction was opened at:/)
		// The transaction rolled back and the mutex is free: the handle works.
		const rows = await db.execute(sql`select count(*)::int as n from things`)
		expect((rows.rows[0] as { n: number }).n).toBe(0)
	})

	test("a second outer transaction inside a transaction is refused the same way", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "throw")
		const road = db.transaction(async () => {
			await db.transaction(async (tx) => {
				await tx.execute(sql`select 1`)
			})
		})
		await expect(within(5_000, road)).rejects.toBeInstanceOf(
			TransactionDeadlockError
		)
	})

	test("a transaction that uses its own handle throughout — nested savepoints included — commits", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "throw")
		await db.transaction(async (tx) => {
			await tx.execute(sql`insert into things (name) values ('one')`)
			await tx.transaction(async (inner) => {
				await inner.execute(sql`insert into things (name) values ('two')`)
			})
			await tx.select().from(sql`things`)
		})
		const rows = await db.execute(sql`select count(*)::int as n from things`)
		expect((rows.rows[0] as { n: number }).n).toBe(2)
	})

	test("a query after the transaction settled is outside it", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "throw")
		const after = async () => {
			await db.transaction(async (tx) => {
				await tx.execute(sql`insert into things (name) values ('first')`)
			})
			// The same async context as the transaction call, after it: the
			// marker is scoped to the callback and this is not inside it.
			return await db.execute(sql`select count(*)::int as n from things`)
		}
		const rows = await after()
		expect((rows.rows[0] as { n: number }).n).toBe(1)
	})

	test("wrapping twice wraps once", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "throw")
		const once = client.query
		guardTransactions(client, "throw")
		expect(client.query).toBe(once)
		await db.execute(sql`select 1`)
	})
})

describe("with the guard, in warn mode", () => {
	test("a hit is logged at error level and the query is not refused", async () => {
		const { client, db } = await freshDb()
		guardTransactions(client, "warn")
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			// Spawned from inside the transaction, not awaited by it: in
			// warn mode the sentence is logged and the query queues behind
			// the commit exactly as an unguarded one would. (An IIFE, because
			// a drizzle query is a lazy thenable that reaches the client only
			// when awaited — and this one has to reach it while the
			// transaction is still open.)
			let spawned: Promise<unknown> | undefined
			await db.transaction(async (tx) => {
				await tx.execute(sql`insert into things (name) values ('x')`)
				spawned = (async () =>
					await db.execute(sql`select count(*)::int as n from things`))()
			})
			const rows = (await within(5_000, spawned!)) as {
				rows: Array<{ n: number }>
			}
			expect(rows).not.toBe("hung")
			expect(rows.rows[0]!.n).toBe(1)
			expect(logged).toHaveBeenCalledTimes(1)
			expect(String(logged.mock.calls[0]![0])).toMatch(
				/OUTER database handle/
			)
		} finally {
			logged.mockRestore()
		}
	})
})
