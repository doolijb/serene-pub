/**
 * The managed KoboldCPP status card says why a model was unloaded, on the card
 * itself under the "Loaded model" line — never only behind Details, which is
 * closed by default and shown only while performance figures exist. The
 * sentence rides on the `koboldcpp:subprocessStatus` push the view already
 * listens to (`coLoadReason`).
 *
 * The manager tabs are stubbed: they fetch on mount and read their own
 * contexts, and this file is about the card.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { socket, listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		socket: { emit: () => {}, on: () => {}, off: () => {} },
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket,
	typedSocketOrNull: () => null
}))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (key: string, _params: unknown, handler: any) => {
		listen(key, handler)
		return () => {}
	},
	onConnect: () => () => {},
	flushInterestSync: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

vi.mock("./ManagedModelsTab.svelte", () => ({ default: () => {} }))
vi.mock("./DownloadsView.svelte", () => ({ default: () => {} }))
vi.mock(
	"$lib/client/components/koboldcppManager/KoboldCppPerfTab.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte",
	() => ({ default: () => {} })
)

import ManagedConnectionView from "./ManagedConnectionView.svelte"

const REASON =
	"Unloaded the Reply model to draw: 3.1 GB free, the image model needs 6.5 GB."

let app: ReturnType<typeof mount> | null = null
function render() {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(ManagedConnectionView, {
		target: host,
		props: {
			kind: "koboldcpp" as const,
			title: "KoboldCPP",
			connectionId: 7,
			isAdmin: true,
			capabilityDefaults: {},
			managedConnectionIds: [7],
			onBack: () => {},
			onRefreshModels: () => {},
			onRemove: () => {},
			onOpenConnection: () => {}
		},
		context: new Map<any, any>([
			[
				"koboldCppSettingsCtx",
				{
					settings: {
						koboldCppManagerEnabled: true,
						koboldCppManagedMode: "managed",
						koboldCppManagedBinaryVariant: "cuda"
					}
				}
			],
			["ollamaSettingsCtx", { settings: { ollamaManagerBaseUrl: "" } }],
			["panelsCtx", { digest: {} }]
		])
	})
	flushSync()
}
function push(coLoadReason: string | null) {
	listeners.get("koboldcpp:subprocessStatus")!({
		status: "running",
		pid: 42,
		startedAt: Date.now(),
		coLoadReason
	})
	flushSync()
}
const card = () =>
	document.querySelector<HTMLElement>('section[aria-label="Status"]')

beforeEach(() => listeners.clear())
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

describe("the status card's co-load line", () => {
	test("shows the last co-load decision on the card, Details closed", () => {
		render()
		push(REASON)
		expect(card()?.textContent).toContain(REASON)
		expect(card()?.querySelector('[aria-expanded="true"]')).toBeNull()
	})

	test("is absent when there is no decision", () => {
		render()
		push(null)
		expect(card()).not.toBeNull()
		expect(card()!.textContent).not.toContain("Unloaded")
	})
})
