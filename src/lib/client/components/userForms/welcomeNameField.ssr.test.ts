/**
 * The welcome screen's "What should we call you?" field.
 *
 * Shown only to someone with no display name yet, never required: an empty
 * field sends nothing, a filled one saves the display name and the wizard
 * moves on either way.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

import WelcomeNameField from "./WelcomeNameField.svelte"
import { saveWelcomeName } from "./welcomeName"

function renderField(user: { displayName: string | null } | null) {
	return render(WelcomeNameField, {
		props: { value: "" },
		context: new Map<string, unknown>([
			[
				"userCtx",
				{
					user: user && {
						id: 1,
						username: "admin",
						isAdmin: true,
						...user
					}
				}
			]
		])
	}).body
}

const LABEL = "What should we call you?"

describe("the welcome name field", () => {
	test("shows when the person has no display name", () => {
		const html = renderField({ displayName: null })
		expect(html).toContain(LABEL)
		expect(html).not.toContain("required")
	})

	test("shows when the display name is blank", () => {
		expect(renderField({ displayName: "  " })).toContain(LABEL)
	})

	test("hides once the person has a display name", () => {
		expect(renderField({ displayName: "Morgan" })).not.toContain(LABEL)
	})
})

describe("saveWelcomeName", () => {
	function fakeSocket() {
		const emits: Array<{ event: string; payload: any }> = []
		return {
			emits,
			emit(event: string, payload: any) {
				emits.push({ event, payload })
			}
		}
	}

	test("a filled field saves the trimmed display name", () => {
		const socket = fakeSocket()
		expect(saveWelcomeName(socket, "  Morgan ")).toBe(true)
		expect(socket.emits).toEqual([
			{
				event: "users:current:updateDisplayName",
				payload: { displayName: "Morgan" }
			}
		])
	})

	test("an empty field sends nothing", () => {
		const socket = fakeSocket()
		expect(saveWelcomeName(socket, "")).toBe(false)
		expect(saveWelcomeName(socket, "   ")).toBe(false)
		expect(socket.emits).toEqual([])
	})
})

describe("a welcome name the server refuses", () => {
	function harness() {
		const emits: Array<{ event: string; payload: any }> = []
		const toasts: Array<{ title: string; description?: string }> = []
		const socket = {
			emit(event: string, payload: any) {
				emits.push({ event, payload })
			}
		}
		return { emits, toasts, socket }
	}

	test("is said in a toast, because the wizard has already moved on", async () => {
		const { welcomeNameSaver } = await import("./welcomeName")
		const h = harness()
		const saver = welcomeNameSaver(h.socket, (t) => h.toasts.push(t))
		expect(saver.save("Morgan")).toBe(true)
		saver.refused({ error: "That name is too long." })
		expect(h.toasts).toEqual([
			{
				title: "Your name wasn't saved",
				description: "That name is too long. You can set it in Settings › User."
			}
		])
	})

	test("is said once, and only for a save the welcome screen sent", async () => {
		const { welcomeNameSaver } = await import("./welcomeName")
		const h = harness()
		const saver = welcomeNameSaver(h.socket, (t) => h.toasts.push(t))
		// A refusal of a rename made elsewhere (Settings › User says its own).
		saver.refused({ error: "Nope." })
		expect(h.toasts).toEqual([])
		saver.save("Morgan")
		saver.saved()
		saver.refused({ error: "Late." })
		expect(h.toasts).toEqual([])
	})
})
