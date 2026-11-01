/** VoiceFields: prose fields always; speed and dials only as the model lists them. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const socket = { emit() {}, on() {}, off() {} }
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))

import VoiceFields from "./VoiceFields.svelte"
import { emptyVoiceDraft } from "./voiceFields"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})
const render = (controls: any, draft = emptyVoiceDraft()) => {
	app = mount(VoiceFields, {
		target: document.body,
		props: { draft, controls, mayPickVoice: true, idPrefix: "t", tryRequest: () => ({ voiceId: "v" }) }
	})
	flushSync()
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel)

describe("VoiceFields", () => {
	test("unknown controls show the prose fields only", () => {
		render(null)
		expect(q("#t-desc")).not.toBeNull()
		expect(q("#t-lang")).not.toBeNull()
		expect(q("#t-speed")).toBeNull()
		expect(q("#t-stability")).toBeNull()
	})
	test("known controls show speed with bounds and just the listed dials", () => {
		render({ speed: { min: 0.5, max: 2 }, settings: ["stability", "speakerBoost"] })
		const speed = q("#t-speed") as HTMLInputElement
		expect(speed.min).toBe("0.5")
		expect(speed.max).toBe("2")
		expect(q("#t-stability")).not.toBeNull()
		expect(q("#t-style")).toBeNull()
		expect(document.body.textContent).toContain("Speaker boost")
	})
	test("a designing model calls the description the voice itself", () => {
		render({ designsVoice: true })
		expect(document.querySelector('label[for="t-desc"]')!.textContent).toBe("The voice itself")
	})
	test("the try-out is there, and says why it cannot run when blocked", () => {
		app = mount(VoiceFields, {
			target: document.body,
			props: { draft: emptyVoiceDraft(), controls: null, mayPickVoice: true, idPrefix: "t", tryRequest: () => ({}), tryBlocked: "Pick a voice first." }
		})
		flushSync()
		expect(q('[data-testid="voice-tryout-blocked"]')!.textContent).toContain("Pick a voice first.")
	})
})
