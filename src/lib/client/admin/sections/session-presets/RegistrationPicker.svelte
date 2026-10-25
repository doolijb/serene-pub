<script lang="ts">
	import InlineError from "$lib/client/components/InlineError.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * 🚧 **Which pipeline runs** — the registration picker, filtered by fit
	 * (PLAN-layering R4, A11; lane 7, 2026-10-21). For the trigger chosen
	 * above it (an event, an action, or when a routine runs), every published
	 * pipeline the server knows, judged by `fitOf`: those that fit are the
	 * choices, the ones their authors say suit this event first; those that
	 * do not are listed under them, greyed, each with why in words
	 * ("Story reply reads the speaker; scene-opened carries none") — a picker
	 * explains why, it never just hides.
	 *
	 * Choices are radio rows (STYLE-GUIDE §6.6): the picked one in the
	 * selected treatment. The save is judged again in full by the door.
	 */
	import * as Icons from "@lucide/svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	type Candidate = Sockets.SessionAdmin.RegistrationCandidates.Candidate

	interface Props {
		/** What it runs on — the SDK's `Trigger`; null until chosen. */
		trigger: Record<string, unknown> | null
		/** The pipeline picked, by slug. */
		picked: string | null
		/** A pipeline to pick for the person when it fits (an action's own). */
		suggested?: string | null
		onpick: (candidate: Candidate) => void
	}

	let { trigger, picked, suggested = null, onpick }: Props = $props()

	const socket = useTypedSocket()
	let candidates = $state<Candidate[]>([])
	let loading = $state(false)
	let refusal = $state<string | null>(null)
	let asked = 0

	const fitting = $derived(candidates.filter((c) => c.fits))
	const unfit = $derived(candidates.filter((c) => !c.fits))

	$effect(() => {
		const t = trigger
		candidates = []
		refusal = null
		if (!t) return
		const requestId = `candidates:${++asked}`
		loading = true
		const release = declareInterest<"sessionPresets:candidates">("sessionPresets:candidates", (res) => {
			if (res?.requestId !== requestId) return
			release()
			loading = false
			if (res.error) refusal = res.error
			candidates = res.candidates ?? []
			const pick = suggested ? candidates.find((c) => c.slug === suggested && c.fits) : undefined
			if (pick && !picked) onpick(pick)
		})
		socket.emit("sessionPresets:candidates", { trigger: $state.snapshot(t) as Record<string, unknown>, requestId })
		return release
	})
</script>

<div class="flex flex-col gap-2" data-testid="registration-picker">
	{#if !trigger}
		<p class="text-surface-600-400 text-xs">Choose what it runs on first.</p>
	{:else if loading}
		<p class="text-surface-600-400 flex items-center gap-2 text-xs" role="status">
			<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" /> Finding the pipelines that fit…
		</p>
	{:else if refusal}
		<InlineError>{refusal}</InlineError>
	{:else}
		{#if fitting.length}
			<div class="flex flex-col gap-1" role="radiogroup" aria-label="Pipelines that fit">
				{#each fitting as c (c.slug)}
					{@const selected = picked === c.slug}
					<button
						type="button"
						role="radio"
						aria-checked={selected}
						data-candidate={c.slug}
						class="hover:bg-surface-200-800 flex min-h-11 items-center gap-2 rounded-base px-2.5 py-1.5 text-left text-sm {selected
							? 'sidebar-row-active'
							: ''}"
						onclick={() => onpick(c)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate">{c.name}</span>
							<span class="text-surface-600-400 block truncate font-mono text-meta">{c.slug}</span>
						</span>
						{#if c.suits}
							<Badge tone="primary" size="sm" class="shrink-0">Made for this</Badge>
						{/if}
						{#if selected}
							<Icons.Check size={16} class="text-primary-500 shrink-0" aria-hidden="true" />
						{/if}
					</button>
				{/each}
			</div>
		{:else}
			<p class="text-surface-600-400 text-xs" role="status">No published pipeline fits this.</p>
		{/if}
		{#if unfit.length}
			<details class="mt-1" data-testid="registration-picker-unfit">
				<summary class="text-surface-600-400 min-h-11 cursor-pointer text-xs pointer-fine:min-h-0">
					{unfit.length === 1 ? "1 pipeline does not fit" : `${unfit.length} pipelines do not fit`}
				</summary>
				<ul class="mt-1 flex flex-col gap-1">
					{#each unfit as c (c.slug)}
						<li class="rounded-base px-2.5 py-1.5 opacity-70" data-unfit={c.slug}>
							<span class="block text-sm">{c.name}</span>
							<span class="text-surface-600-400 block text-xs">{c.reason}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</div>
