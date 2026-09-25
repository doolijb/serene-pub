/**
 * A remote's widget context (C0b): the component context a UI worker hands
 * a component, as the native `WidgetContext` core's widgets read
 * (`useWidgetContext`). So core's conversation — written against the
 * native context — runs in a worker with no change to its source: the same
 * sections, the same verbs, reaching the host over the component's port.
 */
import {
	EMPTY_TURN_ORDER,
	WIDGET_PROTOCOL,
	type ComponentContext,
	type LayoutV1,
	type ViewerV1,
	type WidgetEvent,
	type WidgetEventKind
} from "@serene-pub/sdk"
import type { WidgetContext, WidgetContextRef } from "$lib/shared/widgets/context"

const NOBODY: ViewerV1 = { userId: null, isAdmin: false, isGuest: false }

export function widgetRefFromComponent(
	ctx: ComponentContext,
	widget: WidgetContext["widget"]
): WidgetContextRef {
	// Any section the host pushes re-projects the context, as a native
	// host's re-projection does.
	let version = $state(0)
	ctx.subscribe(() => version++)

	const current = $derived.by((): WidgetContext => {
		void version
		const scoped = ctx.scoped ?? {}
		return {
			protocol: WIDGET_PROTOCOL,
			widget,
			layout: { v1: (ctx.layout ?? {}) as LayoutV1 },
			session: { v1: (ctx.session ?? { id: 0, name: null }) as WidgetContext["session"]["v1"] },
			channels: { v1: Object.keys(ctx.channels ?? {}) },
			messages: { v1: (ctx.messages ?? []) as WidgetContext["messages"]["v1"] },
			props: { v1: ctx.props ?? {} },
			actions: { v1: (ctx.actions ?? {}) as WidgetContext["actions"]["v1"] },
			settings: { v1: ctx.settings ?? {} },
			annex: { v1: (ctx.annex ?? {}) as WidgetContext["annex"]["v1"] },
			locale: { v1: ctx.locale ?? "en" },
			viewer: { v1: ctx.viewer ?? NOBODY },
			turnOrder: { v1: ctx.turnOrder ?? EMPTY_TURN_ORDER },
			...(scoped.session_full !== undefined ? { session_full: { v1: scoped.session_full } } : {}),
			...(scoped.persona !== undefined ? { persona: { v1: scoped.persona } } : {}),
			...(scoped.characters !== undefined ? { characters: { v1: scoped.characters as unknown[] } } : {}),
			...(scoped.lore !== undefined ? { lore: { v1: scoped.lore } } : {}),
			action: (fn, messageId, payload, action, blockId) => ctx.action(fn, messageId, payload, action, blockId),
			invoke: (key, args) => ctx.invoke(key, args),
			request: ((kind, params) => ctx.request(kind, params)) as WidgetContext["request"],
			// No host menu across the port yet: dismissed, as a native host without one answers.
			menu: async () => null,
			on: (kind: WidgetEventKind | "*", cb: (e: WidgetEvent) => void) =>
				ctx.onEvent((e) => {
					const ev = e as WidgetEvent
					if (kind === "*" || ev.kind === kind) cb(ev)
				}),
			t: (source) => ctx.t(source)
		}
	})

	return {
		get current() {
			return current
		}
	}
}
