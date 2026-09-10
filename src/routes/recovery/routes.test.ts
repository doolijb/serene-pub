/**
 * The recovery routes end to end, minus the part that moves a database.
 *
 * What is asserted here is the shape of the surface rather than the filesystem
 * work behind it — `db/recovery.int.test.ts` does that against a genuinely
 * broken 36 MB directory. These are the properties that live in the handlers
 * and nowhere else:
 *
 * - a first POST **performs nothing**, and says what a second one would do;
 * - a token is spent once, so a browser's "confirm form resubmission" cannot
 *   run a restore twice;
 * - the page never reaches a peer the address rule excludes, whatever the
 *   database state;
 * - and a request that names something that is not there gets a page saying so
 *   rather than a stack trace.
 *
 * Nothing here restores or starts fresh. Those move the data directory this
 * test process is pointed at, which is the same one every other file in this
 * worker is using.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import type { RequestEvent } from "@sveltejs/kit"

const databaseState = vi.hoisted(() => ({ value: { ok: false } as any }))

vi.mock("$lib/server/startup", () => ({
	getDatabaseState: () => databaseState.value,
	restartAfterRecovery: async () => ({ ok: true })
}))

import { GET } from "./+server"
import { POST as postDeleteBackup } from "./delete-backup/+server"
import { POST as postRestore } from "./restore/+server"
import { POST as postFresh } from "./fresh/+server"
import { clearConfirmTokens } from "./guard"
import { recoveryPaths } from "$lib/server/db/recovery"

const paths = recoveryPaths()
const BACKUP = "serene-pub-0.5.9-2026-02-02T00-00-00.tgz"

function event(
	url: string,
	options: { address?: string; form?: Record<string, string> } = {}
): RequestEvent {
	const form = new FormData()
	for (const [key, value] of Object.entries(options.form ?? {}))
		form.set(key, value)
	return {
		url: new URL(`http://localhost:3000${url}`),
		platform: {
			req: { socket: { remoteAddress: options.address ?? "127.0.0.1" } }
		},
		getClientAddress: () => options.address ?? "127.0.0.1",
		request: { formData: async () => form } as unknown as Request
	} as unknown as RequestEvent
}

beforeEach(() => {
	databaseState.value = { ok: false }
	clearConfirmTokens()
	fs.mkdirSync(paths.backupsDir, { recursive: true })
	// Not a real archive: nothing in this file gets far enough to open one.
	fs.writeFileSync(path.join(paths.backupsDir, BACKUP), "x".repeat(2048))
})

afterEach(() => {
	fs.rmSync(path.join(paths.backupsDir, BACKUP), { force: true })
})

describe("GET /recovery", () => {
	test("lists what is there, in plain words, with no script of any kind", async () => {
		const response = await GET(event("/recovery"))
		expect(response.status).toBe(503)
		expect(response.headers.get("cache-control")).toContain("no-store")

		const html = await response.text()
		expect(html).toContain(BACKUP)
		expect(html).toContain(paths.dataDir)
		expect(html.toLowerCase()).toContain("nothing has been changed")
		// Every action on this page is a plain form post. A confirm that
		// depends on JavaScript is a confirm that can silently not appear.
		expect(html).not.toContain("<script")
		expect(html).toContain('method="post"')
	})

	test("is 404 once the database opens again", async () => {
		databaseState.value = { ok: true }
		const response = await GET(event("/recovery"))
		expect(response.status).toBe(404)
		expect(await response.text()).not.toContain(paths.dataDir)
	})

	test("tells a peer off the local network nothing at all", async () => {
		const response = await GET(
			event("/recovery", { address: "203.0.113.7" })
		)
		expect(response.status).toBe(503)
		const body = await response.text()
		expect(body).not.toContain(paths.dataDir)
		expect(body).not.toContain(BACKUP)
		expect(body).not.toMatch(/restore|backup|recovery/i)
	})
})

describe("the confirm step", () => {
	test("a post with no token deletes nothing and asks first", async () => {
		const response = await postDeleteBackup(
			event("/recovery/delete-backup", { form: { name: BACKUP } })
		)
		const html = await response.text()

		// The file is still there. That is the whole assertion.
		expect(fs.existsSync(path.join(paths.backupsDir, BACKUP))).toBe(true)
		expect(html).toContain("Delete this backup?")
		expect(html).toContain('name="confirm"')
		expect(html).toContain(BACKUP)
	})

	test("the token it hands out works once, and then does not", async () => {
		const first = await postDeleteBackup(
			event("/recovery/delete-backup", { form: { name: BACKUP } })
		)
		const token = /name="confirm" value="([^"]+)"/.exec(
			await first.text()
		)?.[1]
		expect(token).toBeTruthy()

		const done = await postDeleteBackup(
			event("/recovery/delete-backup", {
				form: { name: BACKUP, confirm: token! }
			})
		)
		expect(done.status).toBe(303)
		expect(done.headers.get("location")).toBe(
			"/recovery?done=backup-deleted"
		)
		expect(fs.existsSync(path.join(paths.backupsDir, BACKUP))).toBe(false)

		// A refresh re-posts the same form. It must not find anything to do —
		// and here it cannot even find the file, so the page says so.
		fs.writeFileSync(path.join(paths.backupsDir, BACKUP), "x".repeat(2048))
		const again = await postDeleteBackup(
			event("/recovery/delete-backup", {
				form: { name: BACKUP, confirm: token! }
			})
		)
		// 503 like every page here: the instance is still down.
		expect(again.status).toBe(503)
		expect(await again.text()).toContain("Delete this backup?")
		expect(fs.existsSync(path.join(paths.backupsDir, BACKUP))).toBe(true)
	})

	test("start fresh asks before it moves anything", async () => {
		const response = await postFresh(event("/recovery/fresh"))
		const html = await response.text()
		expect(html).toContain("Start with an empty database?")
		expect(html).toContain('name="confirm"')
		// It names the directory that will be moved, and says moved.
		expect(html).toContain(paths.dbPath)
		expect(html).toContain("serene-pub.db.broken-")
		expect(html).toContain("Nothing is deleted")
	})

	test("offers the user-file tier, ticked, only when the backup has one", async () => {
		const withoutTier = await postRestore(
			event("/recovery/restore", { form: { name: BACKUP } })
		)
		const plain = await withoutTier.text()
		// No tier beside this backup, so no box — and the page says outright
		// that media is untouched rather than leaving it unmentioned.
		expect(plain).not.toContain('name="users"')
		expect(plain).toContain("has no user files of its own")

		fs.writeFileSync(
			path.join(paths.backupsDir, BACKUP + ".users.tgz"),
			"x".repeat(4096)
		)
		clearConfirmTokens()
		try {
			const withTier = await postRestore(
				event("/recovery/restore", { form: { name: BACKUP } })
			)
			const html = await withTier.text()
			// Ticked by default (ruled 2026-09-10): a database restored
			// without its media points at images that are not there.
			expect(html).toContain('name="users"')
			expect(html).toMatch(/name="users"[^>]*checked/)
			expect(html).toContain("users.broken-")
		} finally {
			fs.rmSync(path.join(paths.backupsDir, BACKUP + ".users.tgz"), {
				force: true
			})
		}
	})

	test("a token for one action cannot be spent on another", async () => {
		const first = await postDeleteBackup(
			event("/recovery/delete-backup", { form: { name: BACKUP } })
		)
		const token = /name="confirm" value="([^"]+)"/.exec(
			await first.text()
		)?.[1]

		const response = await postRestore(
			event("/recovery/restore", {
				form: { name: BACKUP, confirm: token! }
			})
		)
		// Asked again rather than acted on.
		expect(await response.text()).toContain("Restore this backup?")
		expect(fs.existsSync(path.join(paths.backupsDir, BACKUP))).toBe(true)
	})
})

describe("naming something that is not there", () => {
	test("says so, and creates nothing on the way", async () => {
		const before = fs.readdirSync(paths.dataDir).sort()
		const response = await postRestore(
			event("/recovery/restore", { form: { name: "../meta.json.tgz" } })
		)
		expect(await response.text()).toContain("not there")
		expect(fs.readdirSync(paths.dataDir).sort()).toEqual(before)
	})

	test("and every action refuses a non-local peer before reading the form", async () => {
		for (const handler of [postRestore, postFresh, postDeleteBackup]) {
			const response = await handler(
				event("/recovery/x", {
					address: "203.0.113.7",
					form: { name: BACKUP }
				})
			)
			expect(response.status).toBe(503)
			expect(await response.text()).not.toContain(BACKUP)
		}
		expect(fs.existsSync(path.join(paths.backupsDir, BACKUP))).toBe(true)
	})
})
