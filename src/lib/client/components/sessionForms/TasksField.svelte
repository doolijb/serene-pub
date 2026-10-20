<!--
	🚧 The **background tasks** control (PLAN-genre-restructure §4, ruled
	2026-10-19): one grouped field for everything a genre does around a reply.
	Each task carries a mode — Full · Review · Off — and sits in a trigger
	group that says when it runs. A detachable task (after each turn, every
	few turns) can be dragged into a **bucket** with its own frequency: every
	N turns, or after each scene; the sweep group's own bucket is the default.
	Stored as `TaskSettingsV1`; the genre's pipelines branch on it.

	Genre pins the grouping; this control is the host's and knows no genre.
-->
<script lang="ts">
	import {
	TASK_GROUPS,
	TASK_GROUP_TEXT,
	TASK_MODES,
	normaliseTaskSettings,
	resolveTasks,
	type TaskDecl,
	type TaskEvery,
	type TaskGroup,
	type TaskMode,
	type TaskSettingsV1
} from "@serene-pub/sdk"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import * as Icons from "@lucide/svelte"

	interface Props {
		decls: readonly TaskDecl[]
		value: unknown
		/** The preset's pinned value, under the person's own. */
		pinned?: unknown
		onchange: (v: TaskSettingsV1) => void
		disabled?: boolean
	}
	let { decls, value, pinned, onchange, disabled = false }: Props = $props()

	const settings = $derived(normaliseTaskSettings(value))
	const resolved = $derived(resolveTasks(decls, value, pinned))
	const byKey = $derived(new Map(resolved.map((t) => [t.key, t])))

	const MODE_TEXT: Record<TaskMode, string> = { full: "Full", review: "Review", off: "Off" }
	const KIND_TEXT: Record<TaskDecl["kind"], string> = {
		prose: "words",
		script: "rules",
		both: "rules, words when none"
	}

	const everyText = (e: TaskEvery) => (e === "scene" ? "After each scene" : e <= 1 ? "Every turn" : `Every ${e} turns`)
	const sameEvery = (a: TaskEvery, b: TaskEvery) => a === b

	const detachable = (d: TaskDecl) => d.detachable ?? (d.group === "sweep" || d.group === "reckoning")

	/** Write one task's choice. */
	function setTask(key: string, patch: Partial<{ mode: TaskMode; every: TaskEvery | null }>) {
		const next: TaskSettingsV1 = { v: 1, groups: { ...(settings.groups ?? {}) }, tasks: { ...(settings.tasks ?? {}) } }
		const cur = next.tasks![key] ?? { mode: byKey.get(key)?.mode ?? "off" }
		const row = { ...cur }
		if (patch.mode) row.mode = patch.mode
		if (patch.every === null) delete row.every
		else if (patch.every !== undefined) row.every = patch.every
		next.tasks![key] = row
		onchange(next)
	}
	function setGroup(group: TaskGroup, patch: { every?: TaskEvery; waitForRound?: boolean }) {
		const next: TaskSettingsV1 = { v: 1, groups: { ...(settings.groups ?? {}) }, tasks: { ...(settings.tasks ?? {}) } }
		next.groups![group] = { ...(next.groups![group] ?? {}), ...patch }
		onchange(next)
	}

	/** The sweep group's shared frequency. */
	const sweepEvery = $derived<TaskEvery>(settings.groups?.sweep?.every ?? resolved.find((t) => t.group === "sweep")?.every ?? 5)

	/**
	 * Buckets: the sweep's own (shared frequency), then one per distinct
	 * frequency a detached task chose, then any the person added and left
	 * empty this edit.
	 */
	let extraBuckets = $state<TaskEvery[]>([])
	const buckets = $derived.by(() => {
		const out: { every: TaskEvery; tasks: typeof resolved; shared: boolean }[] = [
			{ every: sweepEvery, tasks: [], shared: true }
		]
		const detached = resolved.filter((t) => t.group !== "sweep" && settings.tasks?.[t.key]?.every !== undefined)
		const own = resolved.filter((t) => t.group === "sweep")
		for (const t of [...own, ...detached]) {
			const e = settings.tasks?.[t.key]?.every ?? (t.group === "sweep" ? sweepEvery : t.every)
			let b = out.find((x) => sameEvery(x.every, e))
			if (!b) out.push((b = { every: e, tasks: [], shared: false }))
			b.tasks.push(t)
		}
		for (const e of extraBuckets) if (!out.some((x) => sameEvery(x.every, e))) out.push({ every: e, tasks: [], shared: false })
		return out
	})

	let dragging = $state<string | null>(null)
	/**
	 * The row whose handle is pressed: only it may be dragged (the app's
	 * row-drag rule, `lorebooks/editor/rowDrag.ts`). A whole row that is
	 * always draggable lets a press on its mode menu start a drag.
	 */
	let armed = $state<string | null>(null)

	/** "How often" for a movable task, the no-drag way to do the same move. */
	type Often = "home" | "shared" | "scene" | `n:${number}`
	const oftenOf = (t: (typeof resolved)[number]): Often => {
		const e = settings.tasks?.[t.key]?.every
		if (e === undefined) return t.group === "sweep" ? "shared" : "home"
		return e === "scene" ? "scene" : (`n:${e}` as Often)
	}
	const oftenOptions = (t: (typeof resolved)[number]) => {
		const ns = new Set<number>([2, 3, 5, 10])
		for (const b of buckets) if (typeof b.every === "number") ns.add(b.every)
		const out: { value: string; label: string }[] = []
		if (t.group === "reckoning") out.push({ value: "home", label: "After each turn" })
		out.push({ value: "shared", label: `With the others (${everyText(sweepEvery).toLowerCase()})` })
		for (const n of [...ns].sort((a, b) => a - b)) out.push({ value: `n:${n}`, label: `Every ${n} turns` })
		out.push({ value: "scene", label: "After each scene" })
		return out
	}
	function setOften(t: (typeof resolved)[number], v: string) {
		if (v === "home" || (v === "shared" && t.group === "sweep")) setTask(t.key, { every: null })
		else if (v === "shared") setTask(t.key, { every: sweepEvery })
		else if (v === "scene") setTask(t.key, { every: "scene" })
		else setTask(t.key, { every: Number(v.slice(2)) })
	}
	function dropInto(e: DragEvent, every: TaskEvery, shared: boolean) {
		e.preventDefault()
		e.stopPropagation()
		const key = dragging
		dragging = null
		armed = null
		if (!key || disabled) return
		const t = byKey.get(key)
		if (!t) return
		if (t.group === "sweep" && shared) setTask(key, { every: null })
		else setTask(key, { every })
	}
	/** Back to where it was declared: after each turn, every turn. */
	function dropHome(e: DragEvent, group: TaskGroup) {
		e.preventDefault()
		e.stopPropagation()
		const key = dragging
		dragging = null
		armed = null
		if (!key || disabled) return
		const t = byKey.get(key)
		if (!t || t.group !== group) return
		setTask(key, { every: null })
	}

	let newBucketKind = $state<"turns" | "scene">("turns")
	let newBucketN = $state(10)
	function addBucket() {
		const e: TaskEvery = newBucketKind === "scene" ? "scene" : Math.max(2, Math.floor(newBucketN || 2))
		if (!buckets.some((b) => sameEvery(b.every, e))) extraBuckets = [...extraBuckets, e]
	}

	const modeOptions = (d: TaskDecl) =>
		TASK_MODES.filter((m) => m !== "review" || d.reviewable !== false).map((m) => ({ value: m, label: MODE_TEXT[m] }))

	const inHome = (t: (typeof resolved)[number]) => t.group === "sweep" || settings.tasks?.[t.key]?.every === undefined
</script>

{#snippet row(t: (typeof resolved)[number])}
	<div
		class="bg-surface-50-950 border-surface-200-800 flex flex-col gap-1.5 rounded-[10px] border px-2 py-1.5"
		class:opacity-60={t.mode === "off"}
		draggable={!disabled && armed === t.key}
		ondragstart={(e) => {
			if (armed !== t.key) return e.preventDefault()
			dragging = t.key
			if (e.dataTransfer) {
				e.dataTransfer.setData("application/x-serene-task", t.key)
				e.dataTransfer.effectAllowed = "move"
			}
		}}
		ondragend={() => {
			dragging = null
			armed = null
		}}
		data-testid="task-row-{t.key}"
	>
		<div class="flex items-start gap-2">
			{#if detachable(t)}
				<button
					type="button"
					class="btn-icon btn-icon-sm text-surface-600-400 hover:preset-tonal-surface pointer-coarse:size-11 size-7 shrink-0 cursor-grab p-0"
					aria-label="Drag {i18nTextIn(t.label) ?? t.key} to another bucket"
					title="Drag to another bucket, or use How often"
					onpointerdown={() => (armed = t.key)}
					onpointerup={() => (armed = null)}
					{disabled}
					data-testid="task-handle-{t.key}"
				>
					<Icons.GripVertical size={16} aria-hidden="true" />
				</button>
			{/if}
			<!-- The name gets the whole line (a narrow panel cut it to "Summarize t…"). -->
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="text-sm">{i18nTextIn(t.label) ?? t.key}</span>
				<span class="text-surface-600-400 line-clamp-2 text-xs" title={i18nTextIn(t.description) ?? ""}>{KIND_TEXT[t.kind]}{i18nTextIn(t.description) ? ` · ${i18nTextIn(t.description)}` : ""}</span>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2 {detachable(t) ? 'pl-9' : ''}">
			<Select
				label="{i18nTextIn(t.label) ?? t.key} mode"
				labelHidden
				class="w-28 shrink-0"
				options={modeOptions(t)}
				value={t.mode}
				onValueChange={(v) => setTask(t.key, { mode: v as TaskMode })}
				{disabled}
			/>
			{#if detachable(t)}
				<Select
					label="How often {i18nTextIn(t.label) ?? t.key} runs"
					labelHidden
					class="min-w-40 flex-1"
					options={oftenOptions(t)}
					value={oftenOf(t)}
					onValueChange={(v) => setOften(t, v)}
					{disabled}
				/>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet sweepSection()}
		<section class="border-surface-200-800 flex flex-col gap-2 rounded-[12px] border p-3" data-testid="task-group-sweep">
			<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h4 class="text-sm font-medium">{TASK_GROUP_TEXT.sweep.label}</h4>
				<span class="text-surface-600-400 text-xs">{TASK_GROUP_TEXT.sweep.cost}</span>
			</div>
			<label class="flex items-center gap-2 text-xs">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.groups?.sweep?.waitForRound ?? true}
					onchange={(e) => setGroup("sweep", { waitForRound: e.currentTarget.checked })}
					{disabled}
				/>
				Wait for everyone's reply before running
			</label>
			{#each buckets as b (String(b.every) + (b.shared ? "*" : ""))}
				<div
					class="bg-surface-100-900 flex flex-col gap-2 rounded-[10px] p-2"
					class:ring-2={dragging !== null}
					class:ring-primary-500={dragging !== null}
					ondragenter={(e) => {
						if (dragging) e.preventDefault()
					}}
					ondragover={(e) => {
						if (!dragging) return
						e.preventDefault()
						if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
					}}
					ondrop={(e) => dropInto(e, b.every, b.shared)}
					data-testid="task-bucket-{String(b.every)}"
				>
					<div class="flex flex-wrap items-center gap-2">
						{#if b.shared}
							<Select
								label="How often"
								labelHidden
								class="w-40"
								options={[
									{ value: "scene", label: "After each scene" },
									...[2, 3, 5, 8, 10, 15, 20].map((n) => ({ value: String(n), label: `Every ${n} turns` }))
								]}
								value={b.every === "scene" ? "scene" : String(b.every)}
								onValueChange={(v) => setGroup("sweep", { every: v === "scene" ? "scene" : Number(v) })}
								{disabled}
							/>
							<span class="text-surface-600-400 text-xs">the shared sweep</span>
						{:else}
							<span class="text-sm font-medium">{everyText(b.every)}</span>
							<span class="text-surface-600-400 text-xs">its own bucket</span>
						{/if}
					</div>
					{#if b.tasks.length}
						{#each b.tasks as t (t.key)}
							{@render row(t)}
						{/each}
					{:else}
						<p class="text-surface-600-400 px-1 text-xs">Drop a task here.</p>
					{/if}
				</div>
			{/each}
			<div class="flex flex-wrap items-center gap-2">
				<Select
					label="New bucket"
					labelHidden
					class="w-40"
					options={[
						{ value: "turns", label: "Every N turns" },
						{ value: "scene", label: "After each scene" }
					]}
					value={newBucketKind}
					onValueChange={(v) => (newBucketKind = v as "turns" | "scene")}
					{disabled}
				/>
				{#if newBucketKind === "turns"}
					<input type="number" class="input w-20" min="2" bind:value={newBucketN} aria-label="Turns" {disabled} />
				{/if}
				<button type="button" class="btn btn-sm preset-tonal" onclick={addBucket} {disabled}>Add a bucket</button>
			</div>
		</section>
{/snippet}

<div class="flex flex-col gap-3" data-testid="tasks-field">
	{#each TASK_GROUPS as group (group)}
		{@const own = resolved.filter((t) => t.group === group)}
		{#if group === "sweep"}
			<!-- Right under "After each turn", so a move between them is short. -->
			{#if resolved.some((t) => t.group === "sweep" || detachable(t))}
				{@render sweepSection()}
			{/if}
		{:else if own.length}
			<section
				class="border-surface-200-800 flex flex-col gap-2 rounded-[12px] border p-3"
				ondragenter={(e) => {
					if (dragging) e.preventDefault()
				}}
				ondragover={(e) => {
					if (!dragging) return
					e.preventDefault()
					if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
				}}
				ondrop={(e) => dropHome(e, group)}
				data-testid="task-group-{group}"
			>
				<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<h4 class="text-sm font-medium">{TASK_GROUP_TEXT[group].label}</h4>
					<span class="text-surface-600-400 text-xs">{TASK_GROUP_TEXT[group].cost}</span>
				</div>
				{#if group === "reckoning"}
					<label class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							class="checkbox"
							checked={settings.groups?.reckoning?.waitForRound ?? true}
							onchange={(e) => setGroup("reckoning", { waitForRound: e.currentTarget.checked })}
							{disabled}
						/>
						Wait for everyone's reply before running
					</label>
				{/if}
				{#each own.filter(inHome) as t (t.key)}
					{@render row(t)}
				{/each}
			</section>
		{/if}
	{/each}

</div>
