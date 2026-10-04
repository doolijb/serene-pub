<script lang="ts">
	/**
	 * Pick the character a user speaks as — their persona in this session.
	 *
	 * A persona is not a row of its own any more: it is a character carrying
	 * `isPersona`. So this picker reads `characters:list` like every other
	 * character surface and narrows it to the flagged ones, rather than being
	 * handed a separate list by each caller.
	 *
	 * **Show all characters** widens it to the whole library. Picking an
	 * unflagged character is allowed and deliberate: the server sets
	 * `is_persona` the first time a character is attached to a session as a
	 * persona (`markCharacterAsPersona`, every `session_personas` insert), so
	 * this component must NOT emit an update of its own — doing so would flag
	 * the character even when the caller's insert is later abandoned.
	 */
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "../Avatar.svelte"
	import EmptyState from "../EmptyState.svelte"
	import * as Icons from "@lucide/svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"

	type PersonaRow = Sockets.Characters.List.Response["characterList"][number]

	interface Props {
		open: boolean
		/**
		 * Characters the caller cannot offer — the ones already in the
		 * session's cast, or already bound. Ids rather than rows: the id is
		 * the only thing a caller ever filters on.
		 */
		excludeIds?: number[]
		onclose?: () => void
		onOpenChange?: (e: { open: boolean }) => void
		onSelect:
			| ((personaId: number) => void)
			| ((persona: Partial<SelectCharacter> & { id: number }) => void)
		title?: string
		description?: string
		returnFullPersona?: boolean
		// Inline create. A picker must never be an overlay with nothing to
		// offer and no way to make something — on a fresh install there are
		// no personas at all, and the session form requires one. Callers that
		// can host a creator pass this; when absent, no create affordance is
		// rendered.
		onCreateNew?: () => void
	}

	let {
		open = $bindable(),
		excludeIds = [],
		onclose,
		onOpenChange,
		onSelect,
		title = "Select persona",
		description,
		returnFullPersona = false,
		onCreateNew
	}: Props = $props()

	let characterList: PersonaRow[] = $state([])
	let search = $state("")
	/** Widen the list past the flagged personas to the whole library. */
	let showAll = $state(false)

	const handleCharactersList = (msg: Sockets.Characters.List.Response) => {
		characterList = msg.characterList || []
	}

	// Bare key — `characters:list` is the whole library, not one session's
	// rows — and standing while the picker is mounted, because it is a cascade
	// target: a character created from the caller's creator re-sends this list.
	$effect(() =>
		requestWithInterest("characters:list", {}, handleCharactersList)
	)

	let available = $derived.by(() => {
		const excluded = new Set(excludeIds)
		return characterList
			.filter(
				(c) =>
					c.id != null &&
					!excluded.has(c.id) &&
					(showAll || !!c.isPersona)
			)
			.sort((a, b) => {
				// The default persona is the one a new session starts with, so
				// it leads; everything else is alphabetical.
				if (!!a.isDefaultPersona !== !!b.isDefaultPersona)
					return a.isDefaultPersona ? -1 : 1
				return (a.name || "").localeCompare(b.name || "")
			})
	})

	let filtered = $derived.by(() => {
		const term = search.trim().toLowerCase()
		if (!term) return available
		return available.filter(
			(p) =>
				(p.name || "").toLowerCase().includes(term) ||
				(p.nickname || "").toLowerCase().includes(term) ||
				(p.description || "").toLowerCase().includes(term)
		)
	})

	function close() {
		if (onOpenChange) {
			onOpenChange({ open: false })
		} else if (onclose) {
			onclose()
		}
	}

	function choose(p: PersonaRow) {
		if (p.id == null) return
		if (returnFullPersona) {
			// For EditSessionForm — return the full character row.
			;(
				onSelect as (
					persona: Partial<SelectCharacter> & { id: number }
				) => void
			)(p as Partial<SelectCharacter> & { id: number })
		} else {
			// For the session page — return just the id.
			;(onSelect as (personaId: number) => void)(p.id)
		}
		close()
	}

	let emptyMessage = $derived(
		search.trim()
			? `No ${showAll ? "characters" : "personas"} found matching "${search}".`
			: showAll
				? "No characters yet — create one to get started."
				: "No personas yet — turn on Show all characters, or flag a character as a persona in the Characters view."
	)
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (onOpenChange) {
			onOpenChange(e)
		} else if (!e.open && onclose) {
			onclose()
		}
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,800px)] space-y-6 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="h2">{title}</h2>
					<button class="btn btn-sm" aria-label="Close" onclick={close}>
						<Icons.X size={20} aria-hidden="true" />
					</button>
				</header>
				{#if description}
					<p class="text-surface-600-400">{description}</p>
				{/if}
				<div class="flex flex-wrap items-center gap-3">
					<input
						class="input min-w-48 flex-1"
						type="text"
						placeholder={showAll
							? "Search characters…"
							: "Search personas…"}
						aria-label={showAll ? "Search characters" : "Search personas"}
						bind:value={search}
					/>
					<Switch
						name="personaSelectShowAll"
						checked={showAll}
						onCheckedChange={(e) => (showAll = e.checked)}
						class="flex shrink-0 items-center gap-2"
					>
						<Switch.Label class="text-sm whitespace-nowrap">
							Show all characters
						</Switch.Label>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
				{#if filtered.length === 0}
					<EmptyState
						icon={Icons.UserRound}
						message={emptyMessage}
						ctaLabel={search.trim() || !onCreateNew
							? undefined
							: "New persona"}
						onCta={search.trim() ? undefined : onCreateNew}
					/>
				{:else}
					<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
						<div
							class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap"
						>
							{#each filtered as p (p.id)}
								<div class="flex p-1 lg:basis-1/2">
									<button
										class="group preset-outlined-surface-400-600 hover:bg-surface-200-800 relative flex w-full gap-3 overflow-hidden rounded p-2"
										onclick={() => choose(p)}
									>
										<div class="w-fit shrink-0">
											<Avatar
												char={p}
												size="lg"
												decorative
											/>
										</div>
										<div
											class="relative flex w-0 min-w-0 flex-1 flex-col"
										>
											<div
												class="flex w-full items-center gap-1 text-left font-semibold"
											>
												<span class="truncate">
													{p.name}
												</span>
												{#if p.isPersona}
													<span
														class="shrink-0"
														title={p.isDefaultPersona
															? "Default persona"
															: "Persona"}
													>
														<Icons.UserRound
															size={14}
															class="text-primary-600-400 shrink-0"
															aria-hidden="true"
														/>
														<span class="sr-only"
															>{p.isDefaultPersona
																? "Default persona"
																: "Persona"}</span
														>
													</span>
												{/if}
											</div>
											<div
												class="text-surface-700-300 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
											>
												{p.description ||
													"No description"}
											</div>
										</div>
									</button>
								</div>
							{/each}
						</div>
					</div>
					{#if onCreateNew}
						<div class="border-surface-300-700 border-t pt-4">
							<button
								type="button"
								class="btn btn-sm preset-tonal-primary flex items-center gap-1"
								onclick={onCreateNew}
							>
								<Icons.Plus size={16} /> New persona
							</button>
						</div>
					{/if}
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
