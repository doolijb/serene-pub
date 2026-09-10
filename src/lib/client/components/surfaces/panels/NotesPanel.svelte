<script lang="ts">
	/**
	 * TEMPORARY TEST ARTIFACT (plan 21). An ST-style tasks / mission list — the
	 * canonical "autopopulated panel" example from the plan. Native, so it takes
	 * zero frontend plumbing beyond registering the component; a real one would
	 * render blocks a pipeline node writes to its channel. Persists per session
	 * to localStorage. Delete once real channel-fed panels land.
	 */
	import * as Icons from "@lucide/svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { useWidgetContext } from "$lib/shared/widgets/context"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

	// PLAN 25 proof-of-consumption: read the unified widget ctx a WidgetHost
	// provides. Guarded — the panel renders fine standalone (ctx undefined).
	// A real migrated panel would source its DATA from here instead of props.
	const widget = useWidgetContext()
	let ctx = $derived(widget?.current)

	// …and of the `on` verb. The probe below prints the last event this widget
	// was handed, which is what makes the event lane VISIBLE rather than merely
	// typed. `$effect` for the subscription so the unsubscribe is the cleanup —
	// a probe that leaked a listener per re-render would be a poor advert for
	// the verb it exists to demonstrate.
	let lastEvent = $state<string>("—")
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

	interface Task {
		id: string
		text: string
		done: boolean
	}
	let tasks = $state<Task[]>([])
	let draft = $state("")
	// Cheap monotonic id without Date.now (kept deterministic-ish per session).
	let seq = new SvelteMap<string, number>()

	$effect(() => {
		const id = sessionId
		if (id == null) return
		try {
			const saved = localStorage.getItem(`samplePanel:tasks:${id}`)
			tasks = saved ? JSON.parse(saved) : []
		} catch {
			tasks = []
		}
	})
	function persist() {
		if (sessionId == null) return
		try {
			localStorage.setItem(
				`samplePanel:tasks:${sessionId}`,
				JSON.stringify(tasks)
			)
		} catch {}
	}
	function add() {
		const t = draft.trim()
		if (!t) return
		const n = (seq.get("n") ?? 0) + 1
		seq.set("n", n)
		tasks = [...tasks, { id: `t${n}-${t.length}`, text: t, done: false }]
		draft = ""
		persist()
	}
	function toggle(id: string) {
		tasks = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
		persist()
	}
	function remove(id: string) {
		tasks = tasks.filter((t) => t.id !== id)
		persist()
	}
</script>

<div class="flex h-full flex-col gap-2 p-2">
	{#if ctx}
		<!-- PLAN 25 ctx probe: proves the unified data pipe reaches a native
		     widget. Session, the REAL placement the zone measured (grid dims,
		     this widget's cell, the zone edges it touches, its own width tier),
		     the scoped message count, and the last event the `on` verb
		     delivered. `edges` reads t/r/b/l, upper-case for the ones it touches. -->
		{@const l = ctx.layout.v1}
		<div
			class="preset-tonal-primary rounded px-2 py-1 text-[10px]"
			data-testid="widget-ctx-probe"
			title="Unified widget context (PLAN 25)"
		>
			ctx · {ctx.session.v1.name ?? `#${ctx.session.v1.id}`} · zone {l.zone
				.columns}×{l.zone.rows} @ c{l.zone.column}r{l.zone.row} · box {l
				.box.cols}×{l.box.rows ?? "auto"} · edges {(
				[
					["t", l.box.edges.top],
					["r", l.box.edges.right],
					["b", l.box.edges.bottom],
					["l", l.box.edges.left]
				] as const
			)
				.map(([k, on]) => (on ? k.toUpperCase() : k))
				.join("")} · {l.tier} · {ctx.messages.v1.length} msg · ev {eventCount}:
			{lastEvent}
		</div>
	{/if}
	<form
		class="flex gap-1"
		onsubmit={(e) => {
			e.preventDefault()
			add()
		}}
	>
		<input
			class="input text-xs"
			placeholder="Add a task…"
			bind:value={draft}
		/>
		<button class="btn-icon preset-tonal-primary btn-icon-sm" aria-label="Add">
			<Icons.Plus size={14} />
		</button>
	</form>
	<ul class="min-h-0 flex-1 space-y-1 overflow-auto">
		{#each tasks as t (t.id)}
			<li
				class="bg-surface-100-900 flex items-center gap-2 rounded px-2 py-1 text-xs"
			>
				<button
					onclick={() => toggle(t.id)}
					aria-label="Toggle done"
					class="text-surface-500 hover:text-primary-500"
				>
					{#if t.done}
						<Icons.CheckSquare size={14} class="text-success-500" />
					{:else}
						<Icons.Square size={14} />
					{/if}
				</button>
				<span class="flex-1 truncate" class:line-through={t.done}
					>{t.text}</span
				>
				<button
					onclick={() => remove(t.id)}
					aria-label="Remove"
					class="text-surface-500 hover:text-error-500"
				>
					<Icons.X size={13} />
				</button>
			</li>
		{:else}
			<li class="text-surface-500 py-6 text-center text-[11px]">
				No tasks yet.
			</li>
		{/each}
	</ul>
</div>
