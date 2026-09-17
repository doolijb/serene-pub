/**
 * Backups, from inside a working instance.
 *
 * `db/backup.ts` says of its own scope that backups are "never culled
 * automatically" and that "deleting a user's backups without being asked is not
 * a decision this module gets to make. Retention controls come later." This is
 * later, and this is that control — with the asking kept where it belongs. The
 * ruling behind it (3, 2026-09-09) keeps every backup forever and adds no cull;
 * what it adds is a **Back up now** an owner can press and a **Delete** they can
 * choose, which is the whole difference between "no retention policy" and "no
 * way to manage backups".
 *
 * A daily schedule arrived later (ruled 2026-09-10) and deliberately did not
 * land here: it runs unattended, with nobody's socket open, so it lives as a
 * managed service (`services/dailyBackup.ts`). What this file gained from that
 * ruling is one parameter — the one-shot `includeUserFiles` override beside
 * **Back up now**.
 *
 * **No restore here, and that is deliberate.** Restoring means swapping the
 * data directory out from under a live PGlite client with open sockets on it,
 * and the state where restoring is the right answer is the one where this
 * handler cannot run at all — the database will not open, so the socket server
 * never attaches (see `loadSockets.server.ts`). Restore lives on the recovery
 * page and in `npm run db:recover`, both of which run without a database.
 *
 * Admin only, every handler, checked the way the rest of `sockets/` checks it.
 * A backup archive is a complete copy of every session, every character and
 * every stored credential on the instance; the list alone names files a
 * non-admin has no business knowing exist.
 */
import type { Handler } from "$lib/shared/events"
import * as dbConfig from "$lib/server/db/drizzle.config"

function requireAdmin(socket: any): void {
	if (!socket.user!.isAdmin) throw new Error("Unauthorized")
}

async function listResponse(): Promise<Sockets.Backups.List.Response> {
	const { listBackups, listBrokenDirs, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)
	const paths = recoveryPaths()
	return {
		dataDir: paths.dataDir,
		backupsDir: paths.backupsDir,
		backups: listBackups(paths),
		setAside: listBrokenDirs(paths)
	}
}

export const backupsList: Handler<
	Sockets.Backups.List.Params,
	Sockets.Backups.List.Response
> = {
	event: "backups:list",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket)
		const res = await listResponse()
		emitToUser("backups:list", res)
		return res
	}
}

export const backupsCreate: Handler<
	Sockets.Backups.Create.Params,
	Sockets.Backups.Create.Response
> = {
	event: "backups:create",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket)
		const { backupNow } = await import("$lib/server/db/recovery")
		// No `db` passed: the running instance's is exactly what should be
		// dumped, and `backupNow` imports it lazily to stay off the module cycle
		// that db/index.ts documents.
		//
		// `includeUserFiles` is a one-shot override and is forwarded as-is:
		// undefined means "whatever the setting says", which is what Back up
		// now sends unless the admin ticked the box beside it.
		const created = await backupNow({
			label: params?.label,
			includeUserFiles: params?.includeUserFiles
		})
		const res: Sockets.Backups.Create.Response = {
			backup: {
				name: created.name,
				bytes: created.bytes,
				modifiedAt: created.modifiedAt,
				hasMeta: created.hasMeta,
				hasUsers: created.hasUsers,
				usersBytes: created.usersBytes
			}
		}
		emitToUser("backups:create", res)
		// The list this client is showing is now one row short of the truth —
		// for whoever is showing one. `backups:list` is gated, and this is the
		// lazy form: with Settings → Data closed everywhere, the backups
		// directory is never walked at all. Awaited so the refreshed list still
		// lands before this handler returns, exactly as it did eagerly.
		await emitToUser("backups:list", () => listResponse())
		return res
	}
}

export const backupsDelete: Handler<
	Sockets.Backups.Delete.Params,
	Sockets.Backups.Delete.Response
> = {
	event: "backups:delete",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket)
		const { deleteBackup, deleteBrokenDir } = await import(
			"$lib/server/db/recovery"
		)
		// Both callees validate the name against the directory they own — a
		// name with a separator or a `..` never becomes a path. Nothing is
		// re-derived here, so there is no second, weaker check to disagree with
		// the real one.
		if (params.kind === "setAside") deleteBrokenDir(params.name)
		else deleteBackup(params.name)

		console.log(
			`[backups] ${params.kind === "setAside" ? "set-aside database" : "backup"} ` +
				`"${params.name}" deleted by admin ${socket.user!.id} ` +
				`from ${dbConfig.dataDir}`
		)

		const res: Sockets.Backups.Delete.Response = {
			name: params.name,
			success: true
		}
		emitToUser("backups:delete", res)
		// Lazy, for the reason given in `backupsCreate` above.
		await emitToUser("backups:list", () => listResponse())
		return res
	}
}

export function registerBackupHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, backupsList, emitToUser)
	register(socket, backupsCreate, emitToUser)
	register(socket, backupsDelete, emitToUser)
}
