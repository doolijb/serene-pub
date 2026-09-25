<script lang="ts">
	/**
	 * The session form's pipeline cards (PLAN-turn-order §4.11): one swap
	 * picker for each node the session's pipelines expose to it — the turn
	 * order's strategy first among them — replacing the dead speaker-strategy
	 * control. What each node may become, and what the session chose, come
	 * from `sessions:pipelineCards`; a choice is `sessions:setNodeRebind`,
	 * and "Pipeline default" clears it back to the node's pin.
	 *
	 * Two skins, one behaviour: `app` for the themed form, `document` for
	 * Document View's plain controls.
	 */
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		sessionId: number
		/** Only the owner may change a card; everyone else reads it. */
		canEdit: boolean
		variant?: "app" | "document"
		/** The themed skin's card class, from the form around it. */
		cardClass?: string
	}

	let { sessionId, canEdit, variant = "app", cardClass = "" }: Props = $props()

	const socket = useTypedSocket()
	type Card = Sockets.Sessions.Bindings.PipelineCards.Card
	let cards = $state<Card[]>([])
	/** The pick not yet applied, per card. */
	let draft = $state<Record<string, string>>({})

	const keyOf = (c: Card) => `${c.spec}#${c.nodeKey}`
	const DEFAULT = ""

	const onCards = (res: Sockets.Sessions.Bindings.PipelineCards.Response) => {
		if (res.sessionId !== sessionId) return
		cards = res.cards
		// A choice equal to the pin is the default, said as such.
		draft = Object.fromEntries(res.cards.map((c) => [keyOf(c), stored(c)]))
	}
	/** The card this form applied — its answer is the only one it reports. */
	let pending: string | null = null
	const onSet = (res: Sockets.Sessions.Bindings.SetNodeRebind.Response) => {
		if (res.sessionId !== sessionId) return
		if (pending !== `${res.spec}#${res.nodeKey}`) return
		pending = null
		if (res.error) toaster.error({ title: "Not changed", description: res.error })
		else toaster.success({ title: "Saved" })
	}

	/** BARE: neither event has a `SCOPED_EVENTS` entry; the handlers filter. */
	$effect(() => requestWithInterest("sessions:pipelineCards", { sessionId }, onCards))
	useInterest<"sessions:setNodeRebind">("sessions:setNodeRebind", onSet)

	function apply(c: Card) {
		const pick = draft[keyOf(c)] ?? DEFAULT
		pending = keyOf(c)
		socket.emit("sessions:setNodeRebind", {
			sessionId,
			spec: c.spec,
			nodeKey: c.nodeKey,
			definitionId: pick === DEFAULT ? null : pick
		})
	}

	const nodeLabel = (key: string) => {
		const last = key.split(".").pop() ?? key
		return last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, " ")
	}
	const defaultName = (c: Card) =>
		c.options.find((o) => o.definitionId === c.default)?.name ?? "the pipeline's own"
	function stored(c: Card): string {
		return c.selected && c.selected !== c.default ? c.selected : DEFAULT
	}
	const changed = (c: Card) => (draft[keyOf(c)] ?? DEFAULT) !== stored(c)
	/**
	 * The options a card lists: the offered swaps, plus the stored choice
	 * when it is no longer offered (its plugin was switched off) — shown as
	 * such, so the select never lands on nothing.
	 */
	const choices = (c: Card) => {
		const list = c.options.filter((o) => o.definitionId !== c.default)
		const s = stored(c)
		if (s !== DEFAULT && !list.some((o) => o.definitionId === s))
			list.push({ definitionId: s, name: `${s} (no longer offered)` })
		return list
	}
</script>

{#each cards as c (keyOf(c))}
	{@const id = `pipeline-card-${keyOf(c).replace(/[^a-z0-9]+/gi, "-")}`}
	{#if variant === "document"}
		<div class="a11y-field">
			<label for={id}>{c.specName}: {nodeLabel(c.nodeKey)}</label>
			<div class="a11y-inline-add">
				<select {id} bind:value={draft[keyOf(c)]} disabled={!canEdit}>
					<option value={DEFAULT}>Pipeline default ({defaultName(c)})</option>
					{#each choices(c) as o (o.definitionId)}
						<option value={o.definitionId}>{o.name}</option>
					{/each}
				</select>
				{#if canEdit}
					<button
						type="button"
						class="a11y-btn a11y-btn-secondary a11y-btn-small"
						disabled={!changed(c)}
						onclick={() => apply(c)}
					>
						Apply
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<section class={cardClass}>
			<label class="text-surface-600-400 mb-1.5 block text-xs" for={id}>
				{c.specName} · {nodeLabel(c.nodeKey)}
			</label>
			<div class="flex items-center gap-2">
				<select
					{id}
					class="select rounded-[10px]"
					bind:value={draft[keyOf(c)]}
					disabled={!canEdit}
				>
					<option value={DEFAULT}>Pipeline default ({defaultName(c)})</option>
					{#each choices(c) as o (o.definitionId)}
						<option value={o.definitionId}>{o.name}</option>
					{/each}
				</select>
				{#if canEdit}
					<button
						type="button"
						class="btn btn-sm preset-tonal shrink-0"
						disabled={!changed(c)}
						onclick={() => apply(c)}
					>
						Apply
					</button>
				{/if}
			</div>
		</section>
	{/if}
{/each}
