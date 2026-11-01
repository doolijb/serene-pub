/**
 * audio.cpp, run by Serene Pub — the socket layer (`audiocpp:*`).
 *
 * One admin-only handler per request event, shaped like KoboldCPP's: a
 * refusal answers on `audiocpp:<event>:error` with a sentence, then rethrows
 * so the shared wrapper logs it. Pushes (binary and package download
 * progress, subprocess status) are bound per admin once per connection and
 * unbound on disconnect.
 */
import path from "path"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { ensureAudioCppSettings } from "$lib/server/audiocpp/settings"
import { resyncManagedAudioCpp } from "$lib/server/audiocpp/resync"
import { isAndroidWrapper } from "$lib/server/utils"
import {
	listAudioCppBinaryVariants,
	listAudioCppReleaseVersions,
	startAudioCppBinaryDownload,
	cancelAudioCppBinaryDownload,
	getAudioCppInstallState,
	binaryDownloadEmitters
} from "$lib/server/audiocpp/binary"
import { getAudioLists } from "$lib/server/audio/audioList"
import { buildPackageFamilies } from "$lib/server/audiocpp/packageFamilies"
import { modelsDirFor } from "$lib/server/koboldcpp/modelsDir"
import {
	resolveAudioModelsDir,
	listAudioCppPackages,
	startAudioCppPackageDownload,
	cancelAudioCppPackageDownload,
	removeAudioCppPackage,
	setAudioCppPackageEnabled,
	confirmAudioCppFamily,
	packageDownloadEmitters
} from "$lib/server/audiocpp/packages"
import {
	audioCppSupervisor,
	startAudioCpp,
	stopAudioCpp,
	restartAudioCpp,
	applyAudioCppConfig,
	getAudioCppStatusView,
	audioCppBaseUrl,
	statusViewFromEvent
} from "$lib/server/audiocpp/process"
import { foldAudioCppManagedBaseUrl } from "$lib/server/audiocpp/managedEndpoint"

type Settings = Sockets.AudioCpp.EditableSettings

function isInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v)
}

/**
 * Check a settings patch. Returns a sentence naming the first problem, or
 * null when the patch is acceptable. Pure.
 */
export function validateAudioCppSettingsPatch(
	patch: Partial<Settings> | null | undefined
): string | null {
	if (!patch || typeof patch !== "object") return "Nothing to update."
	if ("enabled" in patch && typeof patch.enabled !== "boolean")
		return "Enabled must be on or off."
	if ("port" in patch) {
		if (!isInt(patch.port) || patch.port < 1024 || patch.port > 65535)
			return "The port must be a whole number from 1024 to 65535."
	}
	for (const [key, label] of [
		["threads", "Threads"],
		["maxLoadedModels", "Most models loaded at once"]
	] as const) {
		if (key in patch) {
			const v = patch[key]
			if (v !== null && (!isInt(v) || v < 1))
				return `${label} must be a whole number of 1 or more, or left empty.`
		}
	}
	if ("idleUnloadMs" in patch) {
		const v = patch.idleUnloadMs
		if (v !== null && (!isInt(v) || v < 0))
			return "Idle unload time must be a whole number of milliseconds (0 or more), or left empty."
	}
	if ("subprocessTimeoutMinutes" in patch) {
		const v = patch.subprocessTimeoutMinutes
		if (!isInt(v) || v < 0)
			return "Idle minutes before audio.cpp stops must be a whole number, 0 or more (0 = never)."
	}
	if ("deviceIndex" in patch) {
		const v = patch.deviceIndex
		if (v !== null && (!isInt(v) || v < 0))
			return "The device index must be a whole number, 0 or more, or left empty."
	}
	if ("modelsDir" in patch) {
		const v = patch.modelsDir
		if (v !== null) {
			if (typeof v !== "string" || !path.isAbsolute(v.trim()))
				return "The models directory must be a full (absolute) path, or left empty."
		}
	}
	return null
}

async function settingsView(): Promise<Sockets.AudioCpp.SettingsView> {
	const s = await ensureAudioCppSettings(db)
	return {
		enabled: s.enabled,
		binaryDir: s.binaryDir ?? null,
		binaryVariant: s.binaryVariant ?? null,
		releaseTag: s.releaseTag ?? null,
		port: s.port,
		modelsDir: s.modelsDir ?? null,
		modelsDirResolved: resolveAudioModelsDir(s),
		backend: s.backend ?? null,
		deviceIndex: s.deviceIndex ?? null,
		threads: s.threads ?? null,
		maxLoadedModels: s.maxLoadedModels ?? null,
		idleUnloadMs: s.idleUnloadMs ?? null,
		subprocessTimeoutMinutes: s.subprocessTimeoutMinutes,
		configHash: s.configHash ?? null,
		baseUrl: audioCppBaseUrl(s)
	}
}

type Emit = (event: string, data: any) => void

/**
 * An admin-only handler whose failures answer `<event>:error` with the
 * error's own sentence, and whose result is emitted on `<event>`.
 */
function adminHandler<P, R>(
	event: string,
	run: (params: P, socket: any, emitToUser: Emit) => Promise<R>
): Handler<P, R> {
	return {
		event,
		handler: async (socket: any, params: P, emitToUser: Emit) => {
			try {
				if (!socket.user?.isAdmin) throw new Error("Unauthorized")
				const res = await run(params, socket, emitToUser)
				emitToUser(event, res)
				return res
			} catch (err: any) {
				emitToUser(`${event}:error`, {
					error:
						err?.message ||
						"audio.cpp could not do that. Check the server log for details."
				})
				throw err
			}
		}
	} as Handler<P, R>
}

const statusView = () => getAudioCppStatusView(db, { probe: true })

/** The managed row's model rows follow its packages; the connections list follows them. */
async function relistModels(emitToUser: Emit) {
	await resyncManagedAudioCpp(db)
	// Dynamic: `sockets/connections` is heavy and this file's unit test
	// imports only the pure validator.
	const { buildConnectionsList } = await import("$lib/server/sockets/connections")
	await emitToUser("connections:list", () => buildConnectionsList())
}

export const audioCppGetSettings = adminHandler<
	Sockets.AudioCpp.GetSettings.Params,
	Sockets.AudioCpp.GetSettings.Response
>("audiocpp:getSettings", async () => ({ settings: await settingsView() }))

export const audioCppUpdateSettings = adminHandler<
	Sockets.AudioCpp.UpdateSettings.Params,
	Sockets.AudioCpp.UpdateSettings.Response
>("audiocpp:updateSettings", async (patch) => {
	const problem = validateAudioCppSettingsPatch(patch)
	if (problem) throw new Error(problem)
	// Same guard as KoboldCPP's: no child processes in the Android wrapper.
	if (patch?.enabled === true && isAndroidWrapper())
		throw new Error(
			"audio.cpp, run by Serene Pub, is not available in the Android app."
		)
	const before = await ensureAudioCppSettings(db)
	const set: Partial<Settings> = {}
	const keys: (keyof Settings)[] = [
		"enabled",
		"port",
		"modelsDir",
		"deviceIndex",
		"threads",
		"maxLoadedModels",
		"idleUnloadMs",
		"subprocessTimeoutMinutes"
	]
	for (const k of keys) {
		if (k in patch) (set as any)[k] = (patch as any)[k]
	}
	if (typeof set.modelsDir === "string") set.modelsDir = set.modelsDir.trim()
	if (set.modelsDir === "") set.modelsDir = null
	const changed = (k: keyof Settings) =>
		k in set && (set as any)[k] !== (before as any)[k]
	if (Object.keys(set).length > 0) {
		await db
			.update(schema.audiocppSettings)
			.set(set)
			.where(eq(schema.audiocppSettings.id, before.id))
	}
	if (changed("enabled") && set.enabled === false) {
		// The setting is saved either way; an external audio.cpp (not ours to
		// stop) must not turn the save into an error.
		await stopAudioCpp().catch((err: any) =>
			console.warn("[audio.cpp] stop on switch-off:", err?.message)
		)
	}
	if (
		(
			[
				"port",
				"modelsDir",
				"deviceIndex",
				"threads",
				"maxLoadedModels",
				"idleUnloadMs"
			] as const
		).some(changed)
	) {
		await applyAudioCppConfig(db)
	}
	if (changed("port")) await foldAudioCppManagedBaseUrl(db)
	if (changed("subprocessTimeoutMinutes"))
		audioCppSupervisor.setIdleTimeoutSecs(
			(set.subprocessTimeoutMinutes as number) * 60
		)
	return { settings: await settingsView() }
})

export const audioCppListBinaryVariants = adminHandler<
	Sockets.AudioCpp.ListBinaryVariants.Params,
	Sockets.AudioCpp.ListBinaryVariants.Response
>("audiocpp:listBinaryVariants", async (params) =>
	listAudioCppBinaryVariants({ tag: params?.tag })
)

export const audioCppListReleaseVersions = adminHandler<
	Sockets.AudioCpp.ListReleaseVersions.Params,
	Sockets.AudioCpp.ListReleaseVersions.Response
>("audiocpp:listReleaseVersions", async () => listAudioCppReleaseVersions())

export const audioCppDownloadBinary = adminHandler<
	Sockets.AudioCpp.DownloadBinary.Params,
	Sockets.AudioCpp.DownloadBinary.Response
>("audiocpp:downloadBinary", async (params) => {
	if (!params?.assetName || !params?.releaseTag)
		throw new Error("Choose a build and a release to download.")
	await startAudioCppBinaryDownload(db, {
		assetName: params.assetName,
		releaseTag: params.releaseTag,
		beforeInstall: () => stopAudioCpp()
	})
	return { success: true }
})

export const audioCppCancelBinaryDownload = adminHandler<
	Sockets.AudioCpp.CancelBinaryDownload.Params,
	Sockets.AudioCpp.CancelBinaryDownload.Response
>("audiocpp:cancelBinaryDownload", async () => {
	cancelAudioCppBinaryDownload()
	return { success: true }
})

export const audioCppInstallState = adminHandler<
	Sockets.AudioCpp.InstallState.Params,
	Sockets.AudioCpp.InstallState.Response
>("audiocpp:installState", async () => getAudioCppInstallState(db))

export const audioCppListPackages = adminHandler<
	Sockets.AudioCpp.ListPackages.Params,
	Sockets.AudioCpp.ListPackages.Response
>("audiocpp:listPackages", async () => {
	const settings = await ensureAudioCppSettings(db)
	const lists = await getAudioLists(db)
	const packages = await listAudioCppPackages(db, {
		lists,
		backend: settings.backend ?? null
	})
	const kobold = await db.query.koboldCppSettings.findFirst()
	const families = await buildPackageFamilies(
		packages,
		lists.entries,
		kobold ? modelsDirFor("embeddings", kobold) : null
	)
	return { packages, families }
})

function requireId(params: { id?: string } | undefined): string {
	if (!params?.id) throw new Error("Choose a package first.")
	return params.id
}

export const audioCppDownloadPackage = adminHandler<
	Sockets.AudioCpp.DownloadPackage.Params,
	Sockets.AudioCpp.DownloadPackage.Response
>("audiocpp:downloadPackage", async (params, socket) => {
	// `userId` raises the settled notification (Downloads tray) for the asker.
	await startAudioCppPackageDownload(db, requireId(params), {
		userId: socket.user?.id
	})
	return { success: true }
})

export const audioCppCancelPackageDownload = adminHandler<
	Sockets.AudioCpp.CancelPackageDownload.Params,
	Sockets.AudioCpp.CancelPackageDownload.Response
>("audiocpp:cancelPackageDownload", async (params) => {
	cancelAudioCppPackageDownload(requireId(params))
	return { success: true }
})

export const audioCppRemovePackage = adminHandler<
	Sockets.AudioCpp.RemovePackage.Params,
	Sockets.AudioCpp.RemovePackage.Response
>("audiocpp:removePackage", async (params, _socket, emitToUser) => {
	const id = requireId(params)
	const before = await ensureAudioCppSettings(db)
	const wasEnabled = (before.enabledPackageIds ?? []).includes(id)
	await removeAudioCppPackage(db, id)
	try {
		if (wasEnabled) await applyAudioCppConfig(db)
	} finally {
		// The file is gone whatever the restart did: the tab must relist.
		await relistModels(emitToUser)
	}
	return { success: true }
})

export const audioCppSetPackageEnabled = adminHandler<
	Sockets.AudioCpp.SetPackageEnabled.Params,
	Sockets.AudioCpp.SetPackageEnabled.Response
>("audiocpp:setPackageEnabled", async (params, _socket, emitToUser) => {
	const id = requireId(params)
	if (typeof params.enabled !== "boolean")
		throw new Error("Say whether the package should be on or off.")
	const pkg = await setAudioCppPackageEnabled(db, id, params.enabled)
	// Rewrites server.json; restarts only when running with a different one.
	// The restart reaches the screen on `audiocpp:subprocessStatus`.
	await applyAudioCppConfig(db)
	await relistModels(emitToUser)
	return { package: pkg }
})

export const audioCppConfirmFamily = adminHandler<
	Sockets.AudioCpp.ConfirmFamily.Params,
	Sockets.AudioCpp.ConfirmFamily.Response
>("audiocpp:confirmFamily", async (params, _socket, emitToUser) => {
	if (!params?.localDir || !params?.family || !params?.task)
		throw new Error("Say which family and task this package is.")
	if (!["tts", "asr", "vdes"].includes(params.task))
		throw new Error("The task must be speech, transcription or voice design.")
	const pkg = await confirmAudioCppFamily(db, {
		localDir: params.localDir,
		family: params.family,
		task: params.task
	})
	await relistModels(emitToUser)
	return { package: pkg }
})

export const audioCppGetStatus = adminHandler<
	Sockets.AudioCpp.GetStatus.Params,
	Sockets.AudioCpp.GetStatus.Response
>("audiocpp:getStatus", async () => ({ status: await statusView() }))

export const audioCppStart = adminHandler<
	Sockets.AudioCpp.Start.Params,
	Sockets.AudioCpp.Start.Response
>("audiocpp:start", async () => {
	await startAudioCpp()
	return { status: await statusView() }
})

export const audioCppStop = adminHandler<
	Sockets.AudioCpp.Stop.Params,
	Sockets.AudioCpp.Stop.Response
>("audiocpp:stop", async () => {
	await stopAudioCpp()
	return { status: await statusView() }
})

export const audioCppRestart = adminHandler<
	Sockets.AudioCpp.Restart.Params,
	Sockets.AudioCpp.Restart.Response
>("audiocpp:restart", async () => {
	await restartAudioCpp()
	return { status: await statusView() }
})

export function registerAudioCppHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	for (const h of [
		audioCppGetSettings,
		audioCppUpdateSettings,
		audioCppListBinaryVariants,
		audioCppListReleaseVersions,
		audioCppDownloadBinary,
		audioCppCancelBinaryDownload,
		audioCppInstallState,
		audioCppListPackages,
		audioCppDownloadPackage,
		audioCppCancelPackageDownload,
		audioCppRemovePackage,
		audioCppSetPackageEnabled,
		audioCppConfirmFamily,
		audioCppGetStatus,
		audioCppStart,
		audioCppStop,
		audioCppRestart
	]) {
		register(socket, h, emitToUser)
	}

	// Pushes: admins only, bound once per connection, unbound on disconnect.
	if (socket.user?.isAdmin) {
		const userId: number = socket.user.id
		binaryDownloadEmitters.register(userId, (d) =>
			emitToUser("audiocpp:binaryDownloadProgress", d)
		)
		packageDownloadEmitters.register(userId, (d) =>
			emitToUser("audiocpp:packageDownloadProgress", d)
		)
		audioCppSupervisor.registerEmitter(userId, (ev) => {
			void (async () => {
				try {
					const settings = await ensureAudioCppSettings(db)
					const status = await statusViewFromEvent(ev, settings)
					emitToUser("audiocpp:subprocessStatus", { status })
				} catch (err: any) {
					console.error("[audio.cpp status push]", err?.message)
				}
			})()
		})

		socket.on("disconnect", () => {
			binaryDownloadEmitters.unregister(userId)
			packageDownloadEmitters.unregister(userId)
			audioCppSupervisor.unregisterEmitter(userId)
		})
	}
}
