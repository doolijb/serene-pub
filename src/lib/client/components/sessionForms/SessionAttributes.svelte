<script lang="ts">
	/**
	 * 🚧 **Attributes** (RF fix 8, owner ruling 2026-10-23): a session's
	 * attributes are its rules' alone — a genre brings none and a session adds
	 * none — so this card is **who carries what** among the rules' optional
	 * attributes: a **Carries ‹attribute›** switch per holder (attribute
	 * carries, RF fix 2 item 3). Off, it is not shown, read or changed for
	 * them; what it held comes back when it is on again. Whoever plays the
	 * holder, or the session's owner, may switch it. Rules that declare none
	 * (Freeform, From scratch) say so. Member copy never names the machinery.
	 */
	import { Switch } from "@skeletonlabs/skeleton-svelte"
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
			declareInterest<"state:attributes:error">("state:attributes:error", refused),
			declareInterest<"state:setCarry">("state:setCarry", take),
			declareInterest<"state:setCarry:error">("state:setCarry:error", refused),
			// Another tab (or a switch here) moved what someone carries.
			declareInterest<"state:changed">(interestKey("state:changed", id), () =>
				socket.emit("state:attributes", { sessionId: id })
			)
		]
		socket.emit("state:attributes", { sessionId: id })
		return () => releases.forEach((release) => release())
	})

	type CarryOwner = Sockets.State.SetCarry.Params["owner"]
	/** 🚧 The rules' attributes by holder: each holder once, their switches in the rules' order. */
	const carriers = $derived.by(() => {
		const out = new Map<string, { owner: CarryOwner; name: string; attributes: { slotId: string; label: string; required: boolean; carries: boolean; mayChange: boolean }[] }>()
		for (const row of view?.carries ?? [])
			for (const h of row.holders) {
				const key = `${h.owner.kind}:${h.owner.id}`
				let holder = out.get(key)
				if (!holder) out.set(key, (holder = { owner: h.owner, name: h.name, attributes: [] }))
				holder.attributes.push({ slotId: row.slotId, label: row.label, required: row.required, carries: h.carries, mayChange: h.mayChange })
			}
		return [...out.values()]
	})
	function sendCarry(owner: CarryOwner, slotId: string, carries: boolean) {
		busy = true
		error = null
		socket.emit("state:setCarry", { sessionId, owner, slotId, carries })
	}
</script>

<section class={cardClass} aria-busy={busy}>
	<h3 class="mb-1 text-sm font-medium">Attributes</h3>
	{#if !view}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else}
		{#if error}
			<p class="text-error-600-400 mb-3 text-xs" role="alert">{error}</p>
		{/if}

		{#if !view.declaresAttributes}
			<p class="text-sm" data-declares-none>This session's rules declare no attributes.</p>
		{:else if !carriers.length}
			<p class="text-surface-600-400 text-xs">Everyone the rules name carries every attribute they keep.</p>
		{/if}

		{#if carriers.length}
			<h4 id="carries-{sessionId}" class="text-surface-600-400 mb-1 text-xs font-medium">Who carries what</h4>
			<p class="text-surface-600-400 mb-2 text-xs">
				Switched off, an attribute is not shown, read or changed for them; what it held comes back when it is on again.
			</p>
			<ul class="flex flex-col gap-3" aria-labelledby="carries-{sessionId}" data-carries>
				{#each carriers as holder (`${holder.owner.kind}:${holder.owner.id}`)}
					<li class="flex flex-col gap-1" data-carry-holder={holder.name}>
						<p class="text-sm font-medium">{holder.name}</p>
						<ul class="flex flex-col gap-1">
							{#each holder.attributes as a (a.slotId)}
								{@const labelId = `carry-${sessionId}-${holder.owner.kind}-${holder.owner.id}-${a.slotId.replace(/[^a-z0-9]+/gi, "-")}`}
								<li class="flex min-h-9 items-center justify-between gap-3 text-sm" data-carry={a.slotId}>
									{#if a.mayChange && !a.required}
										<Switch
											class="flex w-full items-center justify-between gap-3"
											name={labelId}
											checked={a.carries}
											disabled={busy}
											onCheckedChange={(e) => sendCarry(holder.owner, a.slotId, e.checked)}
										>
											<Switch.Label>Carries {a.label}</Switch.Label>
											<Switch.Control class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9">
												<Switch.Thumb />
											</Switch.Control>
											<Switch.HiddenInput />
										</Switch>
									{:else}
										<span>Carries {a.label}</span>
										<span class="text-surface-600-400 text-xs">{a.required ? "Always: the rules require it" : a.carries ? "Yes" : "No"}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
