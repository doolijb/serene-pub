<script lang="ts">
	/**
	 * 🚧 The prompt dialog (owner ask 2026-10-13: "so prompts can be
	 * previewed, i.e. in a popout"): every prompt one step offers, and the
	 * wording of the one being read, so a person can compare before picking.
	 *
	 * Session settings show a member only a dropdown of prompt names; this is
	 * where they read what each one tells the model. The text comes from
	 * `pipelines:promptWording`, which answers only for a prompt the option
	 * offers this viewer. Not a **preview** — in the canon that word is a dry
	 * run — so the code says *wording* and the button says *Read*.
	 *
	 * Two choices per row (STYLE-GUIDE §6.6, a dialog that lets you read each
	 * choice before picking): the row itself opens its wording, and **Use**
	 * picks it and closes the dialog. Read-only when the option is not the
	 * viewer's to change: the rows still open, and no row offers **Use**.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"

	interface Props {
		slug: string
		sessionId?: number
		option: Sockets.Pipelines.Option
		/** The row's label in the panel — the step whose prompt this is. */
		rowLabel: string
		/** The panel's own field labels, so both places name a field alike. */
		fieldLabel: (field: string) => string
		/** False: read the prompts, pick none. */
		canPick: boolean
		onPick: (promptId: number) => void
		onClose: () => void
	}

	let {
		slug,
		sessionId,
		option,
		rowLabel,
		fieldLabel,
		canPick,
		onPick,
		onClose
	}: Props = $props()

	const socket = useTypedSocket()
	const titleId = $props.id()

	type Wording = Sockets.Pipelines.PromptWording.Response
	type Choice = {
		id: number
		label: string
		description?: string
		group?: string
	}

	const GROUPS = [
		{ key: "usedHere", label: "Used in this pipeline" },
		{ key: "shipped", label: "Serene Pub ships" },
		{ key: "alsoFits", label: "Also fits" }
	]

	const inUseId = $derived(
		typeof option.value === "number" ? option.value : null
	)
	/** Every prompt on offer, the one in use included even when it is not a choice. */
	const choices = $derived.by((): Choice[] => {
		const list = ((option.choices ?? []) as Choice[]).slice()
		if (
			inUseId != null &&
			!list.some((c) => c.id === inUseId) &&
			(option as any).prompt?.id === inUseId
		)
			list.unshift({
				id: inUseId,
				label: (option as any).prompt.name,
				group: "usedHere"
			})
		return list
	})
	const grouped = $derived(
		GROUPS.map((g) => ({
			...g,
			rows: choices.filter((c) => (c.group ?? "alsoFits") === g.key)
		})).filter((g) => g.rows.length)
	)

	/** The prompt being read: the one in use, else the first offered. */
	let reading = $state<number | null>(null)
	$effect(() => {
		if (reading == null) reading = inUseId ?? choices[0]?.id ?? null
	})

	const wordings = new SvelteMap<number, Wording>()
	const asked = new Set<number>()

	const mine = (res: Wording) =>
		res.slug === slug && res.optionId === option.id && res.promptId != null

	// Declared before the request effect below: the key is held before the
	// request goes out.
	useInterest<"pipelines:promptWording">("pipelines:promptWording", (res) => {
		if (mine(res)) wordings.set(res.promptId!, res)
	})
	useInterest<"pipelines:promptWording:error">(
		"pipelines:promptWording:error",
		(res) => {
			if (!mine(res)) return
			wordings.set(res.promptId!, res)
			// Forgotten, so Try again asks afresh.
			asked.delete(res.promptId!)
		}
	)

	function retry(id: number) {
		wordings.delete(id)
		asked.add(id)
		socket.emit("pipelines:promptWording", {
			slug,
			optionId: option.id,
			promptId: id,
			sessionId
		})
	}

	$effect(() => {
		const id = reading
		if (id == null || asked.has(id)) return
		asked.add(id)
		socket.emit("pipelines:promptWording", {
			slug,
			optionId: option.id,
			promptId: id,
			sessionId
		})
	})

	const current = $derived(
		reading == null ? undefined : wordings.get(reading)
	)
	const readingLabel = $derived(
		choices.find((c) => c.id === reading)?.label ?? ""
	)

	function pick(id: number) {
		onPick(id)
		onClose()
	}
</script>

<Dialog
	open={true}
	onOpenChange={(e) => {
		if (!e.open) onClose()
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
				class="card bg-surface-100-900 @container/wording flex h-[min(90vh,720px)] w-full max-w-4xl flex-col gap-4 p-6 shadow-xl"
				aria-labelledby={titleId}
			>
				<header class="flex shrink-0 items-start gap-2">
					<div class="min-w-0 flex-1 space-y-1">
						<Dialog.Title
							id={titleId}
							class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							Prompts for {rowLabel}
						</Dialog.Title>
						<Dialog.Description
							class="text-surface-600-400 text-sm"
						>
							{canPick
								? sessionId != null
									? "Read what each prompt tells the model, then use one for this session."
									: "Read what each prompt tells the model, then use one for this configuration."
								: "Read what each prompt tells the model. Changing it here is not yours to do."}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon btn-icon-sm hover:preset-tonal shrink-0"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>

				<div
					class="flex min-h-0 flex-1 flex-col gap-4 @2xl/wording:flex-row"
				>
					<!-- The prompts on offer. A row opens its wording; Use picks it. -->
					<nav
						class="flex max-h-[40%] shrink-0 flex-col gap-3 overflow-y-auto @2xl/wording:max-h-none @2xl/wording:w-64"
						aria-label="Prompts on offer"
					>
						{#each grouped as g (g.key)}
							<div class="flex flex-col gap-1">
								<ListGroupLabel
									label={g.label}
									id="{titleId}-{g.key}"
								/>
								<ul
									class="flex flex-col gap-1"
									aria-labelledby="{titleId}-{g.key}"
								>
									{#each g.rows as c (c.id)}
										{@const isReading = c.id === reading}
										{@const inUse = c.id === inUseId}
										<li
											class="flex min-h-11 items-center gap-1 rounded-base {isReading
												? 'sidebar-row-active'
												: 'hover:bg-surface-200-800'}"
										>
											<button
												type="button"
												class="focus-visible:ring-primary-500 min-w-0 flex-1 rounded-base px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
												aria-current={isReading
													? "true"
													: undefined}
												onclick={() => (reading = c.id)}
											>
												<span
													class="block truncate text-sm font-medium"
												>
													{c.label}
												</span>
												{#if c.description}
													<span
														class="text-surface-600-400 block truncate text-xs"
													>
														{c.description}
													</span>
												{/if}
											</button>
											{#if inUse}
												<span
													class="badge preset-tonal-primary mr-2 shrink-0 text-xs"
												>
													In use
												</span>
											{:else if canPick}
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface mr-1 shrink-0 text-xs"
													aria-label="Use {c.label}"
													onclick={() => pick(c.id)}
												>
													Use
												</button>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-surface-600-400 text-sm">
								This step offers no prompts.
							</p>
						{/each}
					</nav>

					<!-- The wording of the one being read. -->
					<section
						class="bg-surface-50-950 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-base p-4"
						aria-label={readingLabel
							? `Wording of ${readingLabel}`
							: "Wording"}
						aria-busy={reading != null && !current}
					>
						{#if reading == null}
							<p class="text-surface-600-400 text-sm">
								Pick a prompt on the left to read it.
							</p>
						{:else if !current}
							<p
								class="text-surface-600-400 flex items-center gap-2 text-sm"
								role="status"
							>
								<Icons.LoaderCircle
									size={14}
									class="animate-spin"
									aria-hidden="true"
								/>
								Loading the wording…
							</p>
						{:else if current.error}
							<div
								class="flex flex-col items-start gap-2"
								role="alert"
							>
								<p class="text-error-600-400 text-sm">
									{current.error}
								</p>
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									onclick={() => retry(reading!)}
								>
									Try again
								</button>
							</div>
						{:else}
							<div class="flex items-baseline gap-2">
								<h3
									class="min-w-0 flex-1 text-base font-semibold break-words"
								>
									{current.name}
								</h3>
								{#if current.shipped}
									<span
										class="text-surface-600-400 shrink-0 text-xs"
									>
										<Icons.Lock
											size={11}
											class="inline"
											aria-hidden="true"
										/>
										Ships with Serene Pub
									</span>
								{/if}
							</div>
							{#each current.declared ?? [] as field (field)}
								<div class="flex flex-col gap-1">
									<h4
										class="text-surface-600-400 text-xs font-medium"
									>
										{fieldLabel(field)}
									</h4>
									{#if current.fields?.[field]?.trim()}
										<!-- One line, kept so by prettier-ignore: the text keeps its own
										     breaks (pre-wrap), so the markup's must not reach it. -->
										<!-- prettier-ignore -->
										<p class="text-sm leading-relaxed break-words whitespace-pre-wrap">{current.fields[field].trim()}</p>
									{:else}
										<p
											class="text-surface-600-400 text-sm italic"
										>
											Empty
										</p>
									{/if}
								</div>
							{/each}
							{#if canPick && reading !== inUseId}
								<div class="mt-auto flex justify-end pt-2">
									<button
										type="button"
										class="btn preset-filled-primary-500"
										onclick={() => pick(reading!)}
									>
										Use {current.name}
									</button>
								</div>
							{/if}
						{/if}
					</section>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
