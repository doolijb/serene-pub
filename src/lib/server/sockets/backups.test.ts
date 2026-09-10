/**
 * The socket half of backup management.
 *
 * `db/recovery.ts` is mocked here on purpose: what it does with the filesystem
 * is asserted for real, against a genuinely broken 36 MB data directory, in
 * `db/recovery.int.test.ts`. What this file owns is the three things the socket
 * layer adds and can get wrong on its own — the admin gate, the name reaching
 * the right one of two deleters, and the list going back out after a change so
 * no client is left showing a row that no longer exists.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const recovery = vi.hoisted(() => ({
	listBackups: vi.fn(() => [
		{
			name: "serene-pub-0.5.9-2026-02-02T00-00-00.tgz",
			bytes: 4_700_000,
			modifiedAt: "2026-02-02T00:00:00.000Z",
			hasMeta: true,
			hasUsers: true,
			usersBytes: 91_000_000
		}
	]),
	listBrokenDirs: vi.fn(() => [
		{
			name: "serene-pub.db.broken-2026-09-09T10-00-00",
			bytes: 36_000_000,
			modifiedAt: "2026-09-09T10:00:00.000Z",
			kind: "broken" as const
		}
	]),
	recoveryPaths: vi.fn(() => ({
		dataDir: "/data",
		dbPath: "/data/serene-pub.db",
		metaPath: "/data/meta.json",
		backupsDir: "/data/backups"
	})),
	backupNow: vi.fn(async () => ({
		name: "serene-pub-0.6.0-2026-09-09T12-00-00.tgz",
		path: "/data/backups/serene-pub-0.6.0-2026-09-09T12-00-00.tgz",
		bytes: 4_800_000,
		modifiedAt: "2026-09-09T12:00:00.000Z",
		hasMeta: true,
		hasUsers: false,
		usersBytes: 0
	})),
	deleteBackup: vi.fn(),
	deleteBrokenDir: vi.fn()
}))

vi.mock("$lib/server/db/recovery", () => recovery)

import { backupsCreate, backupsDelete, backupsList } from "./backups"

const admin = { user: { id: 1, isAdmin: true } } as any
const nonAdmin = { user: { id: 2, isAdmin: false } } as any

function collector() {
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit: (event: string, data: any) => sent.push({ event, data })
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("who may manage backups", () => {
	test.each([
		["backups:list", () => backupsList.handler(nonAdmin, {}, () => {})],
		["backups:create", () => backupsCreate.handler(nonAdmin, {}, () => {})],
		[
			"backups:delete",
			() =>
				backupsDelete.handler(
					nonAdmin,
					{ name: "x.tgz", kind: "backup" },
					() => {}
				)
		]
	])("%s refuses a non-admin", async (_event, call) => {
		// A backup archive is a complete copy of every session, character and
		// stored credential on the instance. The list alone names files a
		// non-admin has no business knowing exist.
		await expect(call()).rejects.toThrow(/Unauthorized/)
	})

	test("and nothing was touched on the way to refusing", async () => {
		await expect(
			backupsDelete.handler(
				nonAdmin,
				{ name: "x.tgz", kind: "backup" },
				() => {}
			)
		).rejects.toThrow()
		expect(recovery.deleteBackup).not.toHaveBeenCalled()
		expect(recovery.deleteBrokenDir).not.toHaveBeenCalled()
	})
})

describe("backups:list", () => {
	test("reports both lists and where they live", async () => {
		const { sent, emit } = collector()
		const res = await backupsList.handler(admin, {}, emit)

		expect(res.backupsDir).toBe("/data/backups")
		expect(res.backups).toHaveLength(1)
		expect(res.backups[0].hasMeta).toBe(true)
		// The user-file tier reaches the wire, so the panel can say what a
		// backup actually carries before an admin decides to delete it.
		expect(res.backups[0].hasUsers).toBe(true)
		expect(res.backups[0].usersBytes).toBe(91_000_000)
		// Set-aside databases are listed here because this is the only place
		// they can be reached once the instance is healthy again — the recovery
		// page 404s the moment the database opens.
		expect(res.setAside).toHaveLength(1)
		expect(res.setAside[0].kind).toBe("broken")
		expect(sent).toEqual([{ event: "backups:list", data: res }])
	})
})

describe("backups:create", () => {
	test("passes the label through and re-broadcasts the list", async () => {
		const { sent, emit } = collector()
		const res = await backupsCreate.handler(
			admin,
			{ label: "before-x" },
			emit
		)

		expect(recovery.backupNow).toHaveBeenCalledWith({
			label: "before-x",
			// Undefined rather than false: absent means "whatever the stored
			// setting says", which is what makes the checkbox an override
			// rather than a second policy.
			includeUserFiles: undefined
		})
		expect(res.backup.name).toMatch(/\.tgz$/)
		// Without the second emit the panel that asked for this keeps showing a
		// list with the new backup missing from it.
		expect(sent.map((s) => s.event)).toEqual([
			"backups:create",
			"backups:list"
		])
	})

	test("an absent label is left to the module's own default", async () => {
		await backupsCreate.handler(admin, {}, () => {})
		expect(recovery.backupNow).toHaveBeenCalledWith({
			label: undefined,
			includeUserFiles: undefined
		})
	})

	test("carries the one-shot user-files override when the box was ticked", async () => {
		await backupsCreate.handler(admin, { includeUserFiles: true }, () => {})
		expect(recovery.backupNow).toHaveBeenCalledWith({
			label: undefined,
			includeUserFiles: true
		})
	})
})

describe("backups:delete", () => {
	test("a backup goes to deleteBackup", async () => {
		const { sent, emit } = collector()
		await backupsDelete.handler(
			admin,
			{ name: "serene-pub-0.5.9.tgz", kind: "backup" },
			emit
		)
		expect(recovery.deleteBackup).toHaveBeenCalledWith(
			"serene-pub-0.5.9.tgz"
		)
		expect(recovery.deleteBrokenDir).not.toHaveBeenCalled()
		expect(sent.map((s) => s.event)).toEqual([
			"backups:delete",
			"backups:list"
		])
	})

	test("a set-aside directory goes to deleteBrokenDir", async () => {
		await backupsDelete.handler(
			admin,
			{
				name: "serene-pub.db.broken-2026-09-09T10-00-00",
				kind: "setAside"
			},
			() => {}
		)
		expect(recovery.deleteBrokenDir).toHaveBeenCalledWith(
			"serene-pub.db.broken-2026-09-09T10-00-00"
		)
		expect(recovery.deleteBackup).not.toHaveBeenCalled()
	})

	test("the name is handed on verbatim, so one validator owns it", async () => {
		// Deliberately not re-checked here. `db/recovery.ts` resolves the name
		// against the directory it owns and refuses anything that is not a
		// plain filename inside it; a second, weaker check in this layer is a
		// second thing to get wrong and disagree with the real one.
		recovery.deleteBackup.mockImplementationOnce(() => {
			throw new Error('"../meta.json" is not a plain filename.')
		})
		await expect(
			backupsDelete.handler(
				admin,
				{ name: "../meta.json", kind: "backup" },
				() => {}
			)
		).rejects.toThrow(/plain filename/)
		expect(recovery.deleteBackup).toHaveBeenCalledWith("../meta.json")
	})
})
