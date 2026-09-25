<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { formatDate } from "../sections/historyDates"
	import { momentLabel, parseMoment } from "./moment"

	/**
	 * Which line of the story is being read, and the fork that makes another.
	 *
	 * ⚠ **`main` is not a branch.** It is the absence of one: the chip says
	 * "main" when `branchId` is null, "main" is refused as a name, and
	 * switching to it clears the address rather than setting it. A row called
	 * main would make `branch_id IS NULL` ambiguous in every query in the book.
	 *
	 * ⚠ A fork takes its date from the moment being READ, so the date is never
	 * asked for twice. Forking while reading as of Y3 parts the two lines at
	 * Y3: from then on main's changes are not this line's (ruled 2026-09-23).
	 * Forking at NOW stores no date at all, which is not the same thing — that
	 * line keeps following main, and the list says so rather than calling it a
	 * fork "from the start".
	 */
	interface Props {
		lorebookId: number
		/** The lines this book has. `main` is never among them. */
		branches: readonly Sockets.Amendments.Branch[]
		/** The line being read. NULL = main. */
		branchId: number | null
		/** The moment being read, as the route spells it. A fork's date. */
		moment?: string
		onSwitch: (branchId: number | undefined) => void
		/** Draw this line beside main. Absent on main, which has no other side. */
		onCompare?: () => void
		/** Whether the comparison is already open. */
		comparing?: boolean
	}

	let {
		lorebookId,
		branches,
		branchId,
		moment,
		onSwitch,
		onCompare,
		comparing = false
	}: Props = $props()

	const socket = useTypedSocket()

	let open = $state(false)
	let forking = $state(false)
	let newName = $state("")
	let renaming = $state<number | null>(null)
	let renameTo = $state("")
	let confirmingDelete = $state<number | null>(null)

	let current = $derived(branches.find((b) => b.id === branchId) ?? null)
	let label = $derived(current?.name ?? "main")
	let forkDate = $derived(parseMoment(moment))

	/**
	 * What a line says about where it left, and what that costs it.
	 *
	 * ⚠ The cut is by STORY DATE, not by when the fork was made (ruled
	 * 2026-09-23): a line forked at Year 3 never reads a change on main dated
	 * Year 4, whether that change was written before the fork or long after.
	 * A line with NO fork date was never cut off from anything, so it keeps
	 * following main — the opposite of "from the start", which is what this
	 * said until the ruling.
	 */
	function forkedAt(b: Sockets.Amendments.Branch): string {
		const from = b.forkedFromBranchId
			? (branches.find((x) => x.id === b.forkedFromBranchId)?.name ??
				"a deleted line")
			: "main"
		if (b.forkYear == null) return `from ${from}, still following it`
		return `from ${from} at ${formatDate({
			year: b.forkYear,
			month: b.forkMonth,
			day: b.forkDay
		})}`
	}

	function reset() {
		forking = false
		newName = ""
		renaming = null
		renameTo = ""
		confirmingDelete = null
	}

	function fork() {
		const name = newName.trim()
		if (!name) return
		socket.emit("amendments:fork", {
			lorebookId,
			name,
			forkedFromBranchId: branchId,
			forkYear: forkDate?.year ?? null,
			forkMonth: forkDate?.month ?? null,
			forkDay: forkDate?.day ?? null
		} satisfies Sockets.Amendments.Fork.Params)
		toaster.success({ title: `Forked ${name}` })
		reset()
		open = false
	}

	function rename(id: number) {
		const name = renameTo.trim()
		if (!name) return
		socket.emit("amendments:renameBranch", {
			lorebookId,
			id,
			name
		} satisfies Sockets.Amendments.RenameBranch.Params)
		reset()
	}

	function remove(id: number) {
		socket.emit("amendments:deleteBranch", {
			lorebookId,
			id
		} satisfies Sockets.Amendments.DeleteBranch.Params)
		// The line being read is going away; the reader lands back on main.
		if (branchId === id) onSwitch(undefined)
		reset()
	}
</script>

<Popover
	{open}
	onOpenChange={(e) => {
		open = e.open
		if (!e.open) reset()
	}}
	positioning={{ placement: "bottom-end" }}
>
	<Popover.Trigger
		class="chip shrink-0 gap-1 text-xs {branchId === null
			? 'preset-tonal-surface'
			: 'preset-tonal-primary'}"
		title="Which line of the story is being read"
		data-lore-branch={label}
	>
		<Icons.GitBranch size={12} aria-hidden="true" />
		<span class="max-w-28 truncate">{label}</span>
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!">
			<Popover.Content
				class="card bg-surface-100-900 flex w-[min(90vw,320px)] flex-col gap-3 p-4 shadow-xl"
			>
				<div class="flex flex-col gap-1">
					<span class="text-sm font-semibold">
						Lines of this story
					</span>
					<p class="text-surface-700-300 text-xs leading-relaxed">
						Before the fork date both lines read the same entries.
						After it, each keeps its own amendments, scenes and cast
						states — a change on one is not a change on the other.
						Nothing merges back.
					</p>
				</div>

				<ul class="flex flex-col gap-1" role="menu" tabindex="-1">
					<li>
						<button
							class="btn btn-sm w-full justify-start {branchId ===
							null
								? 'preset-filled-primary-500'
								: 'preset-filled-surface-400-600'}"
							type="button"
							role="menuitem"
							onclick={() => {
								onSwitch(undefined)
								open = false
							}}
						>
							<Icons.GitBranch size={14} aria-hidden="true" />
							<span class="flex-1 text-left">main</span>
							{#if branchId === null}
								<Icons.Check size={14} aria-hidden="true" />
							{/if}
						</button>
					</li>
					{#each branches as b (b.id)}
						<li class="flex flex-col gap-1">
							{#if renaming === b.id}
								<div class="flex items-center gap-1">
									<input
										class="input input-sm min-w-0 flex-1"
										bind:value={renameTo}
										aria-label="New name for {b.name}"
										onkeydown={(e) =>
											e.key === "Enter" && rename(b.id)}
									/>
									<button
										class="btn btn-sm preset-filled-primary-500 p-2"
										type="button"
										onclick={() => rename(b.id)}
										aria-label="Rename this line"
									>
										<Icons.Check size={14} />
									</button>
								</div>
							{:else if confirmingDelete === b.id}
								<div class="flex flex-col gap-1">
									<p
										class="text-surface-700-300 text-xs leading-relaxed"
									>
										Deleting <strong>{b.name}</strong>
										removes what was written on it — its amendments,
										its own entries and its scenes. Shared entries
										stay. Sessions played on it fall back to
										main.
									</p>
									<div class="flex gap-1">
										<button
											class="btn btn-sm preset-tonal-error flex-1"
											type="button"
											onclick={() => remove(b.id)}
										>
											Delete {b.name}
										</button>
										<button
											class="btn btn-sm preset-filled-surface-400-600"
											type="button"
											onclick={() =>
												(confirmingDelete = null)}
										>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<div class="flex items-center gap-1">
									<button
										class="btn btn-sm min-w-0 flex-1 justify-start {branchId ===
										b.id
											? 'preset-filled-primary-500'
											: 'preset-filled-surface-400-600'}"
										type="button"
										role="menuitem"
										onclick={() => {
											onSwitch(b.id)
											open = false
										}}
									>
										<Icons.GitBranch
											size={14}
											aria-hidden="true"
										/>
										<span
											class="min-w-0 flex-1 truncate text-left"
										>
											{b.name}
										</span>
										{#if branchId === b.id}
											<Icons.Check
												size={14}
												aria-hidden="true"
											/>
										{/if}
									</button>
									<button
										class="btn btn-sm preset-filled-surface-400-600 p-2"
										type="button"
										onclick={() => {
											renaming = b.id
											renameTo = b.name
										}}
										title="Rename {b.name}"
										aria-label="Rename {b.name}"
									>
										<Icons.PenLine size={14} />
									</button>
									<button
										class="btn btn-sm preset-filled-surface-400-600 p-2"
										type="button"
										onclick={() =>
											(confirmingDelete = b.id)}
										title="Delete {b.name}"
										aria-label="Delete {b.name}"
									>
										<Icons.Trash2 size={14} />
									</button>
								</div>
								<span
									class="text-surface-600-400 pl-2 text-[0.68rem]"
								>
									{forkedAt(b)}
								</span>
							{/if}
						</li>
					{/each}
				</ul>

				<hr class="border-surface-300-700" />

				{#if branchId !== null && onCompare && !comparing}
					<button
						class="btn btn-sm preset-tonal-surface w-full justify-start"
						type="button"
						onclick={() => {
							onCompare()
							open = false
						}}
					>
						<Icons.GitCompare size={14} aria-hidden="true" />
						Compare {label} with main
					</button>
				{/if}

				{#if forking}
					<div class="flex flex-col gap-2">
						<label class="text-xs font-semibold" for="fork-name">
							Name the new line
						</label>
						<input
							id="fork-name"
							class="input input-sm"
							bind:value={newName}
							placeholder="marrow-stays"
							onkeydown={(e) => e.key === "Enter" && fork()}
						/>
						<p class="text-surface-700-300 text-xs leading-relaxed">
							It leaves <strong>{label}</strong>
							{#if forkDate}
								at <strong>{momentLabel(moment)}</strong>
								, the moment you are reading. Everything before that
								date stays shared.
							{:else}
								<strong>with no fork date</strong>
								, so it keeps following {label}: a change made
								there reads on this line too. Move the moment
								first if the two should part at a date.
							{/if}
						</p>
						<div class="flex gap-1">
							<button
								class="btn btn-sm preset-filled-primary-500 flex-1"
								type="button"
								onclick={fork}
								disabled={!newName.trim()}
							>
								Fork it
							</button>
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								type="button"
								onclick={reset}
							>
								Cancel
							</button>
						</div>
					</div>
				{:else}
					<button
						class="btn btn-sm preset-tonal-primary w-full justify-start"
						type="button"
						onclick={() => (forking = true)}
					>
						<Icons.GitFork size={14} aria-hidden="true" />
						Fork {label}{forkDate
							? ` at ${momentLabel(moment)}`
							: ""}
					</button>
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
