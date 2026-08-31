<script lang="ts">
	/**
	 * The per-widget context provider (PLAN 25, ruled 2026-08-30). Svelte
	 * `setContext` must run at component init, so per-widget ctx needs a wrapper:
	 * this component projects the widget's data + verbs once via
	 * `buildNativeContext` and puts a reactive handle in context, then renders the
	 * widget inside. The widget reads it with `useWidgetContext()`.
	 *
	 * ONE projection, live-reactive: `ctx` is a `$derived`, so any change to the
	 * session/messages/placement re-projects and every consumer updates — the
	 * native analog of the frame's push. The SAME `projectWidgetData` core feeds
	 * a frame over the port; the only difference here is the boundary.
	 *
	 * `placement` is optional: sites that already know the widget's grid geometry
	 * pass it; sites that don't yet (a placement-agnostic Panel) get a sane
	 * single-widget default until the grid threads real geometry in.
	 */
	import type { Snippet } from "svelte"
	import { setContext } from "svelte"
	import {
		buildNativeContext,
		WIDGET_CONTEXT_KEY,
		type Payload,
		type PlacementInput,
		type ProjectInput,
		type SurfaceMessage,
		type WidgetContext,
		type WidgetContextRef
	} from "$lib/shared/widgets/context"
	import type { WidgetScope } from "$lib/shared/widgets/types"

	interface Props {
		widget: WidgetContext["widget"]
		session: { id: number; name?: string | null } & Record<string, unknown>
		/** Live message list (native gets the reactive array, not a snapshot). */
		messages?: SurfaceMessage[]
		channels?: string[]
		props?: Payload
		grants?: WidgetScope[]
		scoped?: ProjectInput["scoped"]
		/** Grid geometry when the host knows it; a default is used otherwise. */
		placement?: PlacementInput
		/** Routes to the audited trigger path (same as a frame's action). */
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
		) => void
		children: Snippet
	}

	let {
		widget,
		session,
		messages = [],
		channels = [],
		props,
		grants,
		scoped,
		placement,
		onAction,
		children
	}: Props = $props()

	// Interim default until the grid threads real geometry: a single,
	// grid-floating widget touching every zone edge. `chrome` derives to
	// "widget owns its own backdrop", which is the correct no-op default.
	const DEFAULT_PLACEMENT: PlacementInput = {
		zone: { columns: 1, column: 1, rows: 1, row: 1 },
		box: {
			cols: 1,
			rows: null,
			edges: { top: true, right: true, bottom: true, left: true }
		},
		tier: "cozy",
		pinned: false,
		collapsed: false,
		drawered: false
	}

	// request/menu/on are not wired to a real host yet — a native widget that
	// reaches for them gets a clean, explicit failure rather than a silent no-op
	// that looks like it worked. `action` IS real: it rides the same audited
	// trigger path a frame's action does.
	let ctx = $derived<WidgetContext>(
		buildNativeContext(
			{
				session,
				messages,
				channels,
				props,
				placement: placement ?? DEFAULT_PLACEMENT,
				grants,
				scoped
			},
			widget,
			{
				action: (fn, messageId, payload) =>
					onAction?.(fn, messageId, payload),
				request: async (kind) => {
					throw new Error(
						`widget.request("${kind}") is not available yet`
					)
				},
				menu: async () => null,
				on: () => () => {}
			}
		)
	)

	// A stable handle whose getter returns the live derived ctx — consumers stay
	// reactive across re-projections (see WidgetContextRef).
	const ref: WidgetContextRef = {
		get current() {
			return ctx
		}
	}
	setContext(WIDGET_CONTEXT_KEY, ref)
</script>

{@render children()}
