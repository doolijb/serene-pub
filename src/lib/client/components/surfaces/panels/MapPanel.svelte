<script lang="ts">
	/**
	 * TEMPORARY TEST ARTIFACT (plan 21). A self-contained native "map" panel: a
	 * grid you can click to move a token, position persisted per session. Its
	 * only job is to prove the framework end to end — a stateful native surface
	 * that survives being resized, drawered, and re-gridded without losing its
	 * state (because the grid never reparents it). Delete once real panels land.
	 */
	import * as Icons from "@lucide/svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

	// PLAN 25 ctx probe, the same one NotesPanel wears — a second sample panel
	// so the REAL placement can be read in a second zone (a widget's `layout.v1`
	// is about where it sits, so one zone proves half the claim). Guarded: the
	// panel renders fine standalone, ctx undefined.
	const widget = useWidgetContext()
	let ctx = $derived(widget?.current)

	// …and of the `on` verb, same as NotesPanel's. Collapse or move this panel
	// and the count ticks: `layout:changed` is the native lane's analog of the
	// `{ t: "layout" }` a frame is pushed.
	let lastEvent = $state("—")
	let eventCount = $state(0)
	$effect(() => {
		const c = widget?.current
		if (!c) return
		return c.on("*", (e) => {
			eventCount += 1
			const ch = (e as { channel?: string }).channel
			lastEvent = ch ? `${e.kind} ${ch}` : e.kind
		})
	})

	const COLS = 8
	const ROWS = 6
	let token = $state<{ x: number; y: number }>({ x: 3, y: 2 })

	// Per-session persistence (localStorage — a viewer convenience, not truth).
	$effect(() => {
		const id = sessionId
		if (id == null) return
		try {
			const saved = localStorage.getItem(`samplePanel:map:${id}`)
			if (saved) token = JSON.parse(saved)
		} catch {}
	})
	function place(x: number, y: number) {
		token = { x, y }
		if (sessionId == null) return
		try {
			localStorage.setItem(
				`samplePanel:map:${sessionId}`,
				JSON.stringify(token)
			)
		} catch {}
	}
</script>

<div class="flex h-full flex-col gap-2 p-2">
	{#if ctx}
		{@const l = ctx.layout.v1}
		<div
			class="preset-tonal-primary rounded px-2 py-1 text-[10px]"
			data-testid="widget-ctx-probe"
			title="Unified widget context (PLAN 25)"
		>
			ctx · zone {l.zone.columns}×{l.zone.rows} @ c{l.zone.column}r{l.zone
				.row} · box {l.box.cols}×{l.box.rows ?? "auto"} · edges {(
				[
					["t", l.box.edges.top],
					["r", l.box.edges.right],
					["b", l.box.edges.bottom],
					["l", l.box.edges.left]
				] as const
			)
				.map(([k, on]) => (on ? k.toUpperCase() : k))
				.join("")} · {l.tier} · ev {eventCount}: {lastEvent}
		</div>
	{/if}
	<p class="text-surface-500 text-[11px]">
		Click a cell to move the token. Position sticks per session.
	</p>
	<div
		class="grid flex-1 gap-0.5"
		style="grid-template-columns:repeat({COLS},1fr);grid-template-rows:repeat({ROWS},1fr);"
	>
		{#each Array(ROWS) as _, y}
			{#each Array(COLS) as _, x}
				<button
					class="bg-surface-200-800 hover:bg-primary-500/30 flex items-center justify-center rounded-sm transition-colors"
					onclick={() => place(x, y)}
					aria-label="Move token to {x},{y}"
				>
					{#if token.x === x && token.y === y}
						<Icons.MapPin
							size={16}
							class="text-primary-500 drop-shadow"
						/>
					{/if}
				</button>
			{/each}
		{/each}
	</div>
	<div class="text-surface-500 text-center text-[11px]">
		Token @ ({token.x}, {token.y})
	</div>
</div>
