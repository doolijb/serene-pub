/**
 * Core's messages widget mounted natively in a test DOM, shown to the
 * conformance kit as a `ComponentView` (C30 parity) — the same view the
 * harness gives of the remote copy, so one case judges both.
 */
import { flushSync, mount, tick, unmount } from "svelte"
import { EMPTY_TURN_ORDER, WIDGET_PROTOCOL } from "@serene-pub/sdk"
import type { ComponentView } from "@serene-pub/conformance"
import type { WidgetContext, WidgetContextRef } from "$lib/shared/widgets/context"
import NativeMessagesWidgetFixture from "./NativeMessagesWidgetFixture.svelte"

export async function mountNativeMessagesWidget(sections: Record<string, unknown>): Promise<ComponentView> {
	const s = $state<Record<string, unknown>>({ ...sections })
	const invoked: ComponentView["invoked"] = []
	const ref: WidgetContextRef = {
		get current(): WidgetContext {
			return {
				protocol: WIDGET_PROTOCOL,
				widget: { id: "messages", instanceId: "messages", title: "Messages" },
				layout: { v1: {} as WidgetContext["layout"]["v1"] },
				session: { v1: s.session as WidgetContext["session"]["v1"] },
				channels: { v1: [] },
				messages: { v1: (s.messages ?? []) as WidgetContext["messages"]["v1"] },
				props: { v1: {} },
				actions: { v1: (s.actions ?? {}) as WidgetContext["actions"]["v1"] },
				settings: { v1: (s.settings ?? {}) as WidgetContext["settings"]["v1"] },
				annex: { v1: {} },
				locale: { v1: "en" },
				viewer: { v1: s.viewer as WidgetContext["viewer"]["v1"] },
				turnOrder: { v1: (s.turnOrder as WidgetContext["turnOrder"]["v1"] | undefined) ?? EMPTY_TURN_ORDER },
				session_full: { v1: (s.scoped as { session_full?: unknown } | undefined)?.session_full },
				action: () => {},
				invoke: (key, args) => {
					invoked.push({ key, ...(args ?? {}) } as ComponentView["invoked"][number])
				},
				request: (async () => undefined) as WidgetContext["request"],
				menu: async () => null,
				on: () => () => {},
				t: (source) => source
			}
		}
	}
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(NativeMessagesWidgetFixture, { target, props: { widget: ref } })
	const settle = async () => {
		flushSync()
		await tick()
		for (let i = 0; i < 5; i++) await Promise.resolve()
		flushSync()
	}
	await settle()
	const el = (selector: string | Element) => {
		if (typeof selector !== "string") return selector as HTMLElement
		const found = target.querySelector(selector)
		if (!found) throw new Error(`nothing matches '${selector}' in the native widget`)
		return found as HTMLElement
	}
	return {
		html: () => target.innerHTML,
		queryAll: (selector) => [...target.querySelectorAll(selector)],
		async push(section, value) {
			s[section] = value
			await settle()
		},
		async click(selector) {
			el(selector).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
			await settle()
		},
		async input(selector, value) {
			const field = el(selector) as HTMLInputElement
			field.value = value
			field.dispatchEvent(new Event("input", { bubbles: true }))
			await settle()
		},
		invoked,
		refused: [],
		async unmount() {
			await unmount(app)
			target.remove()
		}
	}
}
