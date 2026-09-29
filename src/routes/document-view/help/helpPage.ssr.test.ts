/**
 * The Document View help page's local-runtime links, rendered.
 *
 * `render` from `svelte/server`, like the connections `*.ssr.test.ts` files.
 * What is pinned is the gating: "Ollama, managed" and "KoboldCPP, run by
 * Serene Pub" hide in the Android app on `canRunLocalRuntimes`, as the
 * AccessibleShell nav hides them, even with their flags switched on.
 */
import { describe, expect, test } from "vitest"
import { render } from "svelte/server"

import HelpPage from "./+page.svelte"

function renderHelp(settings: { isAndroidWrapper?: boolean }) {
	return render(HelpPage, {
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			["systemSettingsCtx", { settings }],
			["ollamaSettingsCtx", { settings: { ollamaManagerEnabled: true } }],
			[
				"koboldCppSettingsCtx",
				{ settings: { koboldCppManagerEnabled: true } }
			]
		])
	}).body
}

describe("the help page's local-runtime links", () => {
	test("are listed where this instance can run them", () => {
		const html = renderHelp({ isAndroidWrapper: false })
		expect(html).toContain('href="/document-view/ollama"')
		expect(html).toContain('href="/document-view/koboldcpp"')
	})

	test("are hidden in the Android app", () => {
		const html = renderHelp({ isAndroidWrapper: true })
		expect(html).not.toContain('href="/document-view/ollama"')
		expect(html).not.toContain('href="/document-view/koboldcpp"')
		expect(html).toContain('href="/document-view/connections"')
	})
})
