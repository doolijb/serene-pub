/**
 * A scene's summarize run that fails is said once in the tab that started it
 * (plan A24 leftover, review of the leftovers lane).
 *
 * Three surfaces start one: a scene's editor and the history list in the
 * lorebook workspace, and the session page's Summarize. Each opens the
 * Process scene window on the run, and the window says the failure in place.
 * The workspace and the session page each toasted every failure as well — the
 * same sentence twice, three times with a lorebook docked beside the session.
 * Now the tab has one fallback, declared by Layout: it says a failure only
 * when no window in the tab is showing that run (closed while it ran, or on
 * another scene).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import fs from "fs"
import path from "path"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	declareInterest,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import ProcessSceneModal from "./ProcessSceneModal.svelte"
import { sayUnshownSceneRunFailure } from "./sceneRunShown"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const SCENE = 5
const OTHER_SCENE = 6

let client: ReturnType<typeof makeClientSocket>
let window_: ReturnType<typeof mount> | null = null
let releaseFallback: (() => void) | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	toaster.error.mockClear()
	// The tab's one fallback, as Layout declares it.
	releaseFallback = declareInterest<"scenes:process:error">(
		"scenes:process:error",
		sayUnshownSceneRunFailure
	)
})

afterEach(() => {
	if (window_) unmount(window_)
	window_ = null
	releaseFallback?.()
	releaseFallback = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

/** The window a surface opens as it starts a run on the scene. */
function openRunningWindow(sceneId: number) {
	const target = document.createElement("div")
	document.body.append(target)
	window_ = mount(ProcessSceneModal, {
		target,
		props: {
			open: true,
			onOpenChange: () => {},
			sceneId,
			activityId: null,
			pendingResult: null,
			lorebookId: 7,
			lorebookBindingList: []
		}
	})
	flushSync()
}

const failure = (sceneId: number, error: string) =>
	client.dispatch("scenes:process:error", { sceneId, error })

describe("a failed summarize run", () => {
	test("is said by the window showing the run, and nowhere else", async () => {
		openRunningWindow(SCENE)
		await settle()

		failure(SCENE, "No connection is set to summarize scenes.")
		await settle()

		expect(document.body.textContent).toContain(
			"No connection is set to summarize scenes."
		)
		expect(toaster.error).not.toHaveBeenCalled()
	})

	test("is said once, as a toast, when the window was closed while it ran", async () => {
		openRunningWindow(SCENE)
		await settle()
		unmount(window_!)
		window_ = null
		await settle()

		failure(SCENE, "The scene could not be summarized.")
		await settle()

		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(toaster.error.mock.calls[0]![0]).toMatchObject({
			description: "The scene could not be summarized."
		})
	})

	test("of another scene is said as a toast, not in this window", async () => {
		openRunningWindow(SCENE)
		await settle()

		failure(OTHER_SCENE, "Scene not found.")
		await settle()

		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(document.body.textContent).not.toContain("Scene not found.")
	})
})

describe("who hears scenes:process:error", () => {
	/**
	 * Every declaration of the event in the client: the window (scoped to its
	 * scene) and Layout (the tab's fallback). A page or workspace that toasts
	 * it as well says a failure twice.
	 */
	test("the Process scene window and Layout, and no one else", () => {
		const roots = ["src/lib/client", "src/routes"].map((r) =>
			path.resolve(process.cwd(), r)
		)
		const files: string[] = []
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) walk(full)
				else if (
					/\.(svelte|ts)$/.test(entry.name) &&
					!/\.test\.ts$/.test(entry.name)
				)
					files.push(full)
			}
		}
		roots.forEach(walk)
		const hearers = files
			.filter((file) =>
				/(?:declareInterest|useInterest)<"scenes:process:error">/.test(
					fs.readFileSync(file, "utf8")
				)
			)
			.map((file) => path.relative(process.cwd(), file))
			.sort()
		expect(hearers).toEqual([
			"src/lib/client/components/Layout.svelte",
			"src/lib/client/components/modals/ProcessSceneModal.svelte"
		])
	})
})
