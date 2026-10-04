<script lang="ts">
	/**
	 * 🚧 What this session tracks (ruled 2026-09-25): the genre's own
	 * attributes (always), and — when the genre allows custom attributes —
	 * the ones its world brings (on by default, picked one by one) and any it
	 * adds itself. A change applies at once, from now on: values already
	 * recorded stay, and only what is tracked is written back to the world.
	 */
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"

	let { sessionId, cardClass }: { sessionId: number; cardClass: string } = $props()

	const socket = useTypedSocket()
	type View = Sockets.State.Attributes.Response
	let view = $state<View | null>(null)
	let error = $state<string | null>(null)
	let busy = $state(false)

	$effect(() => {
		const id = sessionId
		const take = (res: View) => {
			if (res.sessionId !== id) return
			view = res
			error = null
			busy = false
		}
		const refused = (e: Sockets.ErrorResponse & { sessionId?: number }) => {
			if (e.sessionId !== undefined && e.sessionId !== id) return
			error = e.error
			busy = false
		}
		const releases = [
			declareInterest<"state:attributes">("state:attributes", take),
			declareInterest<"state:setAttributePicks">("state:setAttributePicks", take),
			declareInterest<"state:attributes:error">("state:attributes:error", refused),
			declareInterest<"state:setAttributePicks:error">("state:setAttributePicks:error", refused),
			// Another tab (or a pick here) moved what the session tracks.
			declareInterest<"state:changed">(interestKey("state:changed", id), () =>
				socket.emit("state:attributes", { sessionId: id })
			)
		]
		socket.emit("state:attributes", { sessionId: id })
		return () => releases.forEach((release) => release())
	})

	function send(params: Omit<Sockets.State.SetAttributePicks.Params, "sessionId">) {
		busy = true
		error = null
		socket.emit("state:setAttributePicks", { sessionId, ...params })
	}

	const addable = $derived(
		(view?.addable ?? []).map((r) => ({ value: r.slotId, label: r.label }))
	)
</script>

<section class={cardClass} aria-busy={busy}>
	<h3 class="mb-1 text-sm font-medium">Attributes</h3>
	{#if !view}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else}
		<p class="text-surface-600-400 mb-3 text-xs">
			{#if view.customAttributes}
				What this session keeps track of. Applies at once, from now on — not
				held for Save; only what is tracked is written back to the world.
			{:else}
				This session's genre decides what it tracks.
			{/if}
		</p>

		{#if error}
			<p class="text-error-600-400 mb-3 text-xs" role="alert">{error}</p>
		{/if}

		{#if view.baseline.length}
			<h4 class="text-surface-600-400 mb-1 text-xs font-medium">From the genre</h4>
			<ul class="mb-3 flex flex-wrap gap-1" aria-label="From the genre">
				{#each view.baseline as row (row.slotId)}
					<li class="chip preset-tonal-surface text-xs">
						{row.label}{#if row.required}<span class="sr-only"> (required)</span><span aria-hidden="true">*</span>{/if}
					</li>
				{/each}
			</ul>
		{:else if !view.customAttributes}
			<p class="text-sm">None.</p>
		{/if}

		{#if view.customAttributes}
			<div class="mb-2 flex items-center justify-between gap-3">
				<h4 id="world-attributes-{sessionId}" class="text-surface-600-400 text-xs font-medium">
					From the world
				</h4>
				<Switch
					name="world-attributes-{sessionId}"
					checked={view.worldAttributes}
					disabled={!view.canEdit || busy}
					onCheckedChange={(e) => send({ worldAttributes: e.checked })}
					aria-labelledby="world-attributes-{sessionId}"
				>
					<Switch.Control class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9">
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
			</div>
			{#if view.world.length}
				<ul class="mb-3 flex flex-col gap-1" aria-labelledby="world-attributes-{sessionId}">
					{#each view.world as row (row.slotId)}
						<li>
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="checkbox"
									checked={row.tracked}
									disabled={!view.canEdit || busy || !view.worldAttributes}
									onchange={(e) =>
										send({ picks: [{ slotId: row.slotId, enabled: e.currentTarget.checked ? null : false }] })}
								/>
								{row.label}
							</label>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 mb-3 text-xs">The world brings none.</p>
			{/if}

			<h4 class="text-surface-600-400 mb-1 text-xs font-medium">This session's own</h4>
			{#if view.own.length}
				<ul class="mb-2 flex flex-wrap gap-1" aria-label="This session's own">
					{#each view.own as row (row.slotId)}
						<li class="chip preset-tonal-primary flex items-center gap-1 text-xs">
							{row.label}
							{#if view.canEdit}
								<button
									type="button"
									class="btn btn-icon btn-icon-sm size-5"
									aria-label="Stop tracking {row.label}"
									title="Stop tracking {row.label}"
									disabled={busy}
									onclick={() => send({ picks: [{ slotId: row.slotId, enabled: false }] })}
								>
									<Icons.X size={12} aria-hidden="true" />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if view.canEdit && addable.length}
				<Select
					label="Add an attribute"
					labelHidden
					placeholder="Add an attribute…"
					options={addable}
					value={null}
					disabled={busy}
					onValueChange={(slotId) => slotId && send({ picks: [{ slotId, enabled: true }] })}
				/>
			{/if}
			{#if !view.canEdit}
				<p class="text-surface-600-400 mt-2 text-xs">Only the session's owner can change these.</p>
			{/if}
		{/if}
	{/if}
</section>
