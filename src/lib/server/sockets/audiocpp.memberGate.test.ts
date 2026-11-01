/**
 * audio.cpp, run by Serene Pub — the member check (server half).
 *
 * Members never see or reach audio.cpp. Every `audiocpp:*` request handler
 * refuses a non-admin (and an unauthenticated) socket with
 * `audiocpp:<event>:error` / `{ error: "Unauthorized" }`, calls nothing that
 * writes or spawns, and no push emitter is bound for a non-admin.
 *
 * The handler list is captured from `registerAudioCppHandlers` itself, so a
 * handler added later is covered without editing this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
	const fns = {
		ensureAudioCppSettings: vi.fn(),
		resyncManagedAudioCpp: vi.fn(),
		listAudioCppBinaryVariants: vi.fn(),
		listAudioCppReleaseVersions: vi.fn(),
		startAudioCppBinaryDownload: vi.fn(),
		cancelAudioCppBinaryDownload: vi.fn(),
		getAudioCppInstallState: vi.fn(),
		getAudioLists: vi.fn(),
		resolveAudioModelsDir: vi.fn(),
		listAudioCppPackages: vi.fn(),
		startAudioCppPackageDownload: vi.fn(),
		cancelAudioCppPackageDownload: vi.fn(),
		removeAudioCppPackage: vi.fn(),
		setAudioCppPackageEnabled: vi.fn(),
		confirmAudioCppFamily: vi.fn(),
		startAudioCpp: vi.fn(),
		stopAudioCpp: vi.fn(),
		restartAudioCpp: vi.fn(),
		applyAudioCppConfig: vi.fn(),
		getAudioCppStatusView: vi.fn(),
		audioCppBaseUrl: vi.fn(),
		statusViewFromEvent: vi.fn()
	}
	const binaryEmitters = { register: vi.fn(), unregister: vi.fn() }
	const packageEmitters = { register: vi.fn(), unregister: vi.fn() }
	const supervisor = { registerEmitter: vi.fn(), unregisterEmitter: vi.fn() }
	const dbCalls = vi.fn()
	// Any property access or call on the db is a recorded touch.
	const db: any = new Proxy(function () {}, {
		get: (_t, p) => {
			dbCalls(String(p))
			return db
		},
		apply: () => {
			dbCalls("call")
			return db
		}
	})
	return { fns, binaryEmitters, packageEmitters, supervisor, db, dbCalls }
})

vi.mock("$lib/server/db", () => ({ db: m.db }))
vi.mock("$lib/server/audiocpp/settings", () => ({
	ensureAudioCppSettings: m.fns.ensureAudioCppSettings
}))
vi.mock("$lib/server/audiocpp/resync", () => ({
	resyncManagedAudioCpp: m.fns.resyncManagedAudioCpp
}))
vi.mock("$lib/server/audiocpp/binary", () => ({
	listAudioCppBinaryVariants: m.fns.listAudioCppBinaryVariants,
	listAudioCppReleaseVersions: m.fns.listAudioCppReleaseVersions,
	startAudioCppBinaryDownload: m.fns.startAudioCppBinaryDownload,
	cancelAudioCppBinaryDownload: m.fns.cancelAudioCppBinaryDownload,
	getAudioCppInstallState: m.fns.getAudioCppInstallState,
	binaryDownloadEmitters: m.binaryEmitters
}))
vi.mock("$lib/server/audio/audioList", () => ({
	getAudioLists: m.fns.getAudioLists
}))
vi.mock("$lib/server/audiocpp/packages", () => ({
	resolveAudioModelsDir: m.fns.resolveAudioModelsDir,
	listAudioCppPackages: m.fns.listAudioCppPackages,
	startAudioCppPackageDownload: m.fns.startAudioCppPackageDownload,
	cancelAudioCppPackageDownload: m.fns.cancelAudioCppPackageDownload,
	removeAudioCppPackage: m.fns.removeAudioCppPackage,
	setAudioCppPackageEnabled: m.fns.setAudioCppPackageEnabled,
	confirmAudioCppFamily: m.fns.confirmAudioCppFamily,
	packageDownloadEmitters: m.packageEmitters
}))
vi.mock("$lib/server/audiocpp/process", () => ({
	audioCppSupervisor: m.supervisor,
	startAudioCpp: m.fns.startAudioCpp,
	stopAudioCpp: m.fns.stopAudioCpp,
	restartAudioCpp: m.fns.restartAudioCpp,
	applyAudioCppConfig: m.fns.applyAudioCppConfig,
	getAudioCppStatusView: m.fns.getAudioCppStatusView,
	audioCppBaseUrl: m.fns.audioCppBaseUrl,
	statusViewFromEvent: m.fns.statusViewFromEvent
}))
vi.mock("$lib/server/audiocpp/managedEndpoint", () => ({
	foldAudioCppManagedBaseUrl: vi.fn()
}))
vi.mock("$lib/server/utils", () => ({ isAndroidWrapper: () => false }))

import { registerAudioCppHandlers } from "./audiocpp"

type Reg = { event: string; handler: (s: any, p: any, e: any) => Promise<any> }

function fakeSocket(user: any) {
	const on = vi.fn()
	return { socket: { id: "s", user, on } as any, on }
}

/** Run `registerAudioCppHandlers` and capture what it hands to `register`. */
function capture(user: any) {
	const { socket, on } = fakeSocket(user)
	const emitToUser = vi.fn()
	const handlers: Reg[] = []
	registerAudioCppHandlers(socket, emitToUser, (_s, h) =>
		handlers.push(h as any)
	)
	return { socket, on, emitToUser, handlers }
}

/** Params rich enough that a handler that skipped its check would get to work. */
const PARAMS = {
	enabled: true,
	port: 5002,
	id: 1,
	packageId: "p",
	family: "kokoro",
	task: "tts",
	localDir: "/x",
	variant: "cpu",
	tag: "v1"
}

beforeEach(() => {
	vi.clearAllMocks()
})

const MEMBER = { id: 2, isAdmin: false }
const ADMIN = { id: 1, isAdmin: true }

describe("audiocpp request handlers refuse a non-admin", () => {
	it("registers 17 request handlers", () => {
		expect(capture(MEMBER).handlers).toHaveLength(17)
		const names = capture(MEMBER).handlers.map((h) => h.event)
		expect(new Set(names).size).toBe(17)
		for (const n of names) expect(n.startsWith("audiocpp:")).toBe(true)
	})

	for (const [label, user] of [
		["member", MEMBER],
		["unauthenticated", undefined],
		["user without isAdmin", { id: 3 }]
	] as const) {
		it(`every handler answers Unauthorized for a ${label} and does no work`, async () => {
			const { handlers, emitToUser, socket } = capture(user)
			expect(handlers).toHaveLength(17)
			for (const h of handlers) {
				emitToUser.mockClear()
				await expect(
					h.handler(socket, { ...PARAMS }, emitToUser)
				).rejects.toThrow("Unauthorized")
				expect(emitToUser).toHaveBeenCalledTimes(1)
				expect(emitToUser).toHaveBeenCalledWith(`${h.event}:error`, {
					error: "Unauthorized"
				})
				// Never the success event.
				expect(
					emitToUser.mock.calls.some(([ev]) => ev === h.event)
				).toBe(false)
			}
			// Nothing behind the handlers ran: no settings read or write, no
			// download, no supervisor, no package change, no resync, no db.
			for (const [name, fn] of Object.entries(m.fns))
				expect(fn, name).not.toHaveBeenCalled()
			expect(m.dbCalls).not.toHaveBeenCalled()
		})
	}

	it("an admin is not refused by the same check (control)", async () => {
		const { handlers, emitToUser, socket } = capture(ADMIN)
		const getStatus = handlers.find((h) => h.event === "audiocpp:getStatus")!
		m.fns.getAudioCppStatusView.mockResolvedValue({ state: "stopped" })
		await getStatus.handler(socket, {}, emitToUser)
		expect(emitToUser).toHaveBeenCalledWith("audiocpp:getStatus", {
			status: { state: "stopped" }
		})
		expect(m.fns.getAudioCppStatusView).toHaveBeenCalledTimes(1)
	})
})

describe("audiocpp push emitters are admin-only", () => {
	it("binds nothing for a member, and no disconnect listener", () => {
		const { on } = capture(MEMBER)
		expect(m.binaryEmitters.register).not.toHaveBeenCalled()
		expect(m.packageEmitters.register).not.toHaveBeenCalled()
		expect(m.supervisor.registerEmitter).not.toHaveBeenCalled()
		expect(on).not.toHaveBeenCalled()
	})

	it("binds nothing for an unauthenticated socket", () => {
		const { on } = capture(undefined)
		expect(m.binaryEmitters.register).not.toHaveBeenCalled()
		expect(m.packageEmitters.register).not.toHaveBeenCalled()
		expect(m.supervisor.registerEmitter).not.toHaveBeenCalled()
		expect(on).not.toHaveBeenCalled()
	})

	it("binds all three for an admin and unbinds them on disconnect", () => {
		const { on, emitToUser } = capture(ADMIN)
		expect(m.binaryEmitters.register).toHaveBeenCalledWith(
			1,
			expect.any(Function)
		)
		expect(m.packageEmitters.register).toHaveBeenCalledWith(
			1,
			expect.any(Function)
		)
		expect(m.supervisor.registerEmitter).toHaveBeenCalledWith(
			1,
			expect.any(Function)
		)
		// The progress closures push on the right event.
		m.binaryEmitters.register.mock.calls[0][1]({ p: 1 })
		m.packageEmitters.register.mock.calls[0][1]({ p: 2 })
		expect(emitToUser).toHaveBeenCalledWith(
			"audiocpp:binaryDownloadProgress",
			{ p: 1 }
		)
		expect(emitToUser).toHaveBeenCalledWith(
			"audiocpp:packageDownloadProgress",
			{ p: 2 }
		)

		const disc = on.mock.calls.find(([e]) => e === "disconnect")
		expect(disc).toBeTruthy()
		disc![1]()
		expect(m.binaryEmitters.unregister).toHaveBeenCalledWith(1)
		expect(m.packageEmitters.unregister).toHaveBeenCalledWith(1)
		expect(m.supervisor.unregisterEmitter).toHaveBeenCalledWith(1)
	})
})
