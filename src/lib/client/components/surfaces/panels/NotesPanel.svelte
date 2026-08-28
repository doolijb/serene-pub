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

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

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
