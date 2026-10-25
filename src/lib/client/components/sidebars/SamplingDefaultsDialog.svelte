<script lang="ts">
	/**
	 * Set as default…: every job of the config's shape, the config each one's
	 * default names today, and a checkbox per job. Apply names this config as
	 * the sampling half of the ticked jobs' defaults
	 * (`samplingConfigs:setDefaultFor`); each job keeps its model.
	 *
	 * A job that already names this config is shown ticked and fixed: taking
	 * a default away is Admin › Defaults' job, never a side effect of
	 * unticking a box here.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { jobLabel, type SamplingJob } from "./samplingList"
	import LoadingState from "$lib/client/components/LoadingState.svelte"

	interface Props {
		open: boolean
		/** The config being named. */
		config: { id: number; name: string } | null
		/** Every job of the config's shape, in the order to show them. */
		jobs: readonly SamplingJob[]
		/** Whether the job list has arrived. */
		loaded: boolean
		/** A config's name by id, for "Uses …". */
		configName: (id: number) => string | null
		busy?: boolean
		onApply: (transforms: string[]) => void
		onClose: () => void
	}

	let {
		open,
		config,
		jobs,
		loaded,
		configName,
		busy = false,
		onApply,
		onClose
	}: Props = $props()

	const ticked = new SvelteSet<string>()
	$effect(() => {
		if (open) ticked.clear()
	})

	const held = (j: SamplingJob) => j.samplingConfigId === config?.id
	const choosable = $derived(jobs.filter((j) => !held(j)))
	const allTicked = $derived(
		choosable.length > 0 && choosable.every((j) => ticked.has(j.capability))
	)
	const someTicked = $derived(
		!allTicked && choosable.some((j) => ticked.has(j.capability))
	)

	function toggleAll(on: boolean) {
		for (const j of choosable)
			if (on) ticked.add(j.capability)
			else ticked.delete(j.capability)
	}
	function toggle(capability: string, on: boolean) {
		if (on) ticked.add(capability)
		else ticked.delete(capability)
	}

	function holderLine(j: SamplingJob): string {
		if (held(j)) return "Uses this config"
		if (j.samplingConfigId == null)
			return "Nothing set: the backend’s own settings"
		return `Uses ${configName(j.samplingConfigId) ?? "a config that is gone"}`
	}
</script>

<Dialog {open} onOpenChange={(e) => !e.open && onClose()}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[85vh] w-full max-w-md flex-col gap-4 p-6 shadow-xl"
				aria-labelledby="sampling-defaults-title"
				aria-describedby="sampling-defaults-desc"
			>
				<header class="flex flex-col gap-1">
					<h2 id="sampling-defaults-title" class="h4">
						Use in loadouts
					</h2>
					<p
						id="sampling-defaults-desc"
						class="text-surface-600-400 text-sm"
					>
						Tick the default loadouts that should use {config?.name ??
							"this config"}. Each loadout keeps its model; only its
						sampling changes.
					</p>
				</header>

				{#if !loaded}
					<LoadingState message="Loading the loadouts…" />
				{:else if !jobs.length}
					<p class="text-surface-600-400 py-4 text-sm">
						No loadout takes a config of this kind.
					</p>
				{:else}
					<div class="flex min-h-0 flex-col gap-1 overflow-y-auto">
						<label
							class="flex items-center gap-3 rounded-base px-3 py-2 text-sm font-semibold"
						>
							<input
								type="checkbox"
								class="accent-primary"
								checked={allTicked}
								indeterminate={someTicked}
								disabled={!choosable.length}
								onchange={(e) =>
									toggleAll(e.currentTarget.checked)}
							/>
							All
						</label>
						<ul class="flex flex-col gap-1" aria-label="Loadouts">
							{#each jobs as j (j.capability)}
								<li>
									<label
										class={[
											"flex items-start gap-3 rounded-base px-3 py-2",
											held(j)
												? "opacity-60"
												: "hover:bg-surface-200-800 cursor-pointer"
										]}
									>
										<input
											type="checkbox"
											class="accent-primary mt-0.5"
											checked={held(j) ||
												ticked.has(j.capability)}
											disabled={held(j)}
											onchange={(e) =>
												toggle(
													j.capability,
													e.currentTarget.checked
												)}
										/>
										<span class="flex min-w-0 flex-col">
											<span class="text-sm font-medium">
												{jobLabel(j.capability)}
											</span>
											<span
												class="text-surface-600-400 truncate text-xs"
											>
												{holderLine(j)}
											</span>
										</span>
									</label>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={busy || ticked.size === 0}
						onclick={() => onApply([...ticked])}
					>
						Apply
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
