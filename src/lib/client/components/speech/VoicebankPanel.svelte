<script lang="ts">
	/**
	 * 🚧 The **Voices** panel of the Loadouts view (speech build, lane E2;
	 * design §4–§6). The voicebank: the pub's named voices. A character's
	 * Voice and a session's narrator pick from these. Admin-only (the Loadouts
	 * view is).
	 *
	 * Every entry speaks through a **loadout** (transform `text->audio`); the
	 * loadout's model decides which voices exist. With no such loadout filled
	 * there is nothing to create and the panel says so, with a door to Loadouts.
	 *
	 * Sockets: `voicebank:*` are gated — one `useInterest` on the list (the
	 * server re-pushes it after every mutation). Refusals arrive on
	 * `<event>:error` and are shown beside the control that asked, never as a
	 * toast.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
	import type { VoicebankSettings } from "$lib/shared/speech/voicebank"
	import { SvelteSet } from "svelte/reactivity"
	import { labelLine } from "./voicePicker"
	import VoicebankForm from "./VoicebankForm.svelte"
	import VoiceTryout from "./VoiceTryout.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	import {
		consequenceLine,
		draftToInput,
		requestOfEntry,
		groupVoicesByLoadout,
		speechFactsOfRow,
		voiceChips,
		type VoicebankDraft
	} from "./voicebankRows"

	interface Props {
		/** Open the text→audio loadouts. */
		onOpenNarration?: () => void
		/** Open one loadout's sheet (a group header's door). */
		onOpenLoadout?: (id: number) => void
	}
	let { onOpenNarration, onOpenLoadout }: Props = $props()

	const socket = useTypedSocket()
	const conns = useConnections()

	let list = $state<Sockets.Voicebank.List.Response | null>(null)
	const voices = $derived(list?.voices ?? [])
	const loadouts = $derived(list?.loadouts ?? [])
	/** By loadout (the loadouts list's order, unassigned last); by name inside each. */
	const groups = $derived(groupVoicesByLoadout(voices, loadouts))
	/** The row whose Try is open (one at a time: a try-out holds one clip). */
	let tryingId = $state<number | null>(null)
	const anyFilled = $derived(loadouts.some((l) => l.filled))

	// ── Errors, shown where the asking control is ───────────────────────────
	/** "form" | "delete" | "list" | `row:<id>` */
	let pending = $state("list")
	let errorScope = $state<string | null>(null)
	let errorText = $state("")
	let busy = $state(false)
	function ask(scope: string) {
		pending = scope
		errorScope = null
		busy = true
	}
	function fail(res: { error?: string } | undefined) {
		busy = false
		errorScope = pending
		errorText = res?.error ?? "That did not go through."
	}
	const errorOf = (scope: string) => (errorScope === scope ? errorText : null)

	// ── Answers ─────────────────────────────────────────────────────────────
	useInterest<"voicebank:list">("voicebank:list", (msg) => {
		list = msg
		busy = false
	})
	useInterest<"voicebank:create">("voicebank:create", () => {
		busy = false
		formOpen = false
	})
	useInterest<"voicebank:update">("voicebank:update", () => {
		busy = false
		formOpen = false
	})
	useInterest<"voicebank:delete">("voicebank:delete", () => {
		busy = false
		deleting = null
	})
	for (const ev of [
		"voicebank:list:error",
		"voicebank:create:error",
		"voicebank:update:error",
		"voicebank:delete:error"
	] as const) {
		useInterest<typeof ev>(ev, (res) => fail(res as { error?: string }))
	}

	// ── Speech facts, per model, fetched on demand ──────────────────────────
	// A voice's facts are those of ITS loadout's model: fetch the model list of
	// that connection the first time a row or the form needs it.
	let factsByModel = $state<Record<number, SpeechFacts>>({})
	const asked = new SvelteSet<number>()
	function needFacts(connectionId: number | null | undefined) {
		if (connectionId == null || asked.has(connectionId)) return
		asked.add(connectionId)
		socket.emit("connections:models", { id: connectionId })
	}
	useInterest<"connections:models">("connections:models", (res) => {
		for (const row of res.models ?? []) {
			const f = speechFactsOfRow(row)
			if (f) factsByModel[row.id] = f
		}
	})
	useInterest<"models:refreshSpeech">("models:refreshSpeech", (res) => {
		for (const r of res.results ?? [])
			if (r.speech) factsByModel[r.connectionModelId] = r.speech
	})
	const loadoutOf = (id: number | null | undefined) =>
		id == null ? null : (loadouts.find((l) => l.id === id) ?? null)
	const factsOfLoadout = (id: number | null | undefined) => {
		const m = loadoutOf(id)?.connectionModelId
		return m == null ? null : (factsByModel[m] ?? null)
	}
	/** The form's chosen loadout: its model's facts feed the voice list and dials. */
	let formLoadoutId = $state<number | null>(null)
	const formFacts = $derived(factsOfLoadout(formLoadoutId))
	function onFormLoadout(id: number | null) {
		formLoadoutId = id
		needFacts(loadoutOf(id)?.connectionId)
	}

	onMount(() => {
		socket.emit("voicebank:list", {})
		conns.requestList()
	})

	// ── Create / edit ───────────────────────────────────────────────────────
	let formOpen = $state(false)
	/** Set by the loadout sheet's door: a new entry starts on this loadout. */
	let presetLoadoutId = $state<number | null>(null)
	let editing = $state<number | null>(null)
	const editEntry = $derived(
		editing == null ? null : (voices.find((v) => v.id === editing) ?? null)
	)
	/** Open the New voice form on `loadoutId` (the loadout sheet's "Add a voice" door). */
	export function addVoice(loadoutId?: number | null) {
		openForm(null, loadoutId)
	}
	function openForm(id: number | null, loadoutId?: number | null) {
		editing = id
		presetLoadoutId = id == null ? (loadoutId ?? null) : null
		errorScope = null
		formOpen = true
	}
	function save(draft: VoicebankDraft) {
		if (draft.loadoutId == null) return
		ask("form")
		const input = draftToInput(draft, editEntry ?? undefined)
		if (editEntry) socket.emit("voicebank:update", { id: editEntry.id, voice: input })
		else socket.emit("voicebank:create", { voice: input })
	}

	// ── Row verbs ───────────────────────────────────────────────────────────
	function setEnabled(id: number, enabled: boolean) {
		ask(`row:${id}`)
		socket.emit("voicebank:update", { id, voice: { enabled } })
	}
	/** A re-rolled seed on a row's inline Try: a trial until kept. */
	let trialSeeds = $state<Record<number, number | null | undefined>>({})
	const trialSeedOf = (v: { id: number; settings: { seed?: number | null } }) =>
		v.id in trialSeeds ? (trialSeeds[v.id] ?? null) : (v.settings.seed ?? null)
	function keepSeed(v: { id: number; settings: VoicebankSettings }) {
		if (!(v.id in trialSeeds)) return
		const seed = trialSeeds[v.id]
		// `settings` is replaced wholesale: keep the rest; a cleared seed is no seed.
		const { seed: _old, ...rest } = v.settings
		ask(`row:${v.id}`)
		socket.emit("voicebank:update", {
			id: v.id,
			voice: { settings: seed == null ? rest : { ...rest, seed } }
		})
	}
	let deleting = $state<number | null>(null)
	const deleteEntry = $derived(
		deleting == null ? null : (voices.find((v) => v.id === deleting) ?? null)
	)
	function confirmDelete() {
		if (deleting == null) return
		ask("delete")
		socket.emit("voicebank:delete", { id: deleting })
	}
</script>

<section class="flex flex-col gap-3" aria-labelledby="voicebank-title">
	<header class="flex flex-wrap items-start justify-between gap-2">
		<div class="min-w-0">
			<h2 id="voicebank-title" class="h3 text-base font-bold">Voices</h2>
			<p class="text-surface-600-400 text-sm">
				The pub's named voices. A character (on its card's Speech tab) and a
				session's narrator pick from these.
			</p>
		</div>
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 shrink-0"
			disabled={!list || !anyFilled}
			onclick={() => openForm(null)}
		>
			<Icons.Plus size={16} aria-hidden="true" />
			New voice
		</button>
	</header>

	{#if !list}
		<p class="text-surface-600-400 text-sm">Loading voices…</p>
	{:else}
		{#if !anyFilled}
			<div class="preset-tonal-surface flex flex-wrap items-center gap-2 rounded-lg p-3 text-sm">
				<span class="min-w-0 flex-1">
					No text→audio loadout has a model yet. Give one a model, and
					every voice on it speaks with that model.
				</span>
				{#if onOpenNarration}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={onOpenNarration}
					>
						Open Loadouts
					</button>
				{/if}
			</div>
		{/if}
		{#if errorOf("list")}
			<p class="text-error-600-400 text-sm" role="alert">{errorOf("list")}</p>
		{/if}

		{#if !voices.length}
			<p class="text-surface-600-400 text-sm">
				No voices yet.{anyFilled
					? " Make one to give a character or the narrator a name to pick."
					: ""}
			</p>
		{:else}
			{#each groups as g (g.loadout?.id ?? "none")}
			<div class="flex flex-col gap-2" data-voice-group={g.loadout?.id ?? "none"}>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<h3 class="text-sm font-semibold">{g.loadout?.name ?? "No loadout"}</h3>
					{#if g.loadout}
						<p class="text-surface-600-400 min-w-0 flex-1 text-xs" data-testid="group-lines">
							<span>Voice: {g.voiceName ?? "none yet"}</span>
							<span aria-hidden="true"> · </span>
							<span>Other speakers: {g.otherSpeakersName ?? "Auto"}</span>
						</p>
						{#if onOpenLoadout}
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal"
								aria-label="Open the {g.loadout.name} loadout"
								onclick={() => onOpenLoadout(g.loadout!.id)}
							>
								Open loadout
							</button>
						{/if}
					{/if}
				</div>
			<ul class="flex flex-col gap-2">
				{#each g.voices as v (v.id)}
					{@const mine = v.owner === "pub"}
					{@const chips = voiceChips(v)}
					<li class="@container/vrow card preset-tonal-surface flex flex-col gap-1.5 p-3" data-voice={v.slug}>
						<div class="flex flex-col gap-2 @min-[44rem]/vrow:flex-row @min-[44rem]/vrow:items-center">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold">{v.name}</p>
								<p class="mt-0.5 flex flex-wrap gap-1">
									<Badge size="sm" data-testid="voice-loadout">
										{v.loadoutName ?? "No loadout"}
									</Badge>
									{#if g.voiceId === v.id}<Badge size="sm" data-testid="voice-is-voice">Voice</Badge>{/if}
									{#each chips as c (c)}<Badge size="sm">{c}</Badge>{/each}
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal"
								aria-expanded={tryingId === v.id}
								aria-controls="vb-try-{v.id}"
								disabled={!!v.unusableReason}
								title={v.unusableReason ? `Cannot try: ${v.unusableReason}` : `Hear ${v.name}`}
								aria-label="Try {v.name}"
								onclick={() => {
									tryingId = tryingId === v.id ? null : v.id
									if (tryingId === v.id) needFacts(loadoutOf(v.loadoutId)?.connectionId)
								}}
							>
								<Icons.Play size={14} aria-hidden="true" />
								Try
							</button>
							<Switch
								name={`voicebank-enabled-${v.id}`}
								checked={v.enabled}
								disabled={busy}
								onCheckedChange={(e) => setEnabled(v.id, e.checked)}
								class="flex items-center gap-2"
							>
								<Switch.Label class="text-xs font-semibold">
									Enabled
								</Switch.Label>
								<Switch.Control
									class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
								>
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
							{#if mine}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									disabled={busy}
									onclick={() => openForm(v.id)}
									aria-label={`Edit ${v.name}`}
								>
									<Icons.Pencil size={14} aria-hidden="true" />
									Edit
								</button>
								<button
									type="button"
									class="btn-icon btn-icon-sm text-error-600-400 hover:preset-tonal-error"
									disabled={busy}
									onclick={() => {
										errorScope = null
										deleting = v.id
									}}
									title={`Delete ${v.name}`}
									aria-label={`Delete ${v.name}`}
								>
									<Icons.Trash2 size={14} aria-hidden="true" />
								</button>
							{/if}
													</div>
						</div>
						{#if labelLine({ labels: v.labels })}
							<p class="text-surface-700-300 text-xs">
								{labelLine({ labels: v.labels })}
							</p>
						{/if}
						<p class="text-surface-600-400 text-xs">
							{consequenceLine(v)}
						</p>
						{#if !mine}
							<p class="text-surface-600-400 flex items-center gap-1 text-xs">
								<Icons.Puzzle size={12} aria-hidden="true" />
								Declared by {v.owner}. Only its Enabled switch
								can be changed here.
							</p>
						{/if}
						{#if tryingId === v.id}
							<div id="vb-try-{v.id}" class="panel-inset rounded-base p-2">
								<VoiceTryout
									request={() => requestOfEntry(v)}
									mayPickVoice={true}
									designsVoice={factsOfLoadout(v.loadoutId)?.controls.designsVoice === true}
									takesDirection={factsOfLoadout(v.loadoutId)?.controls.instruction === "prose"}
									bind:seed={() => trialSeedOf(v), (n) => (trialSeeds[v.id] = n)}
								/>
								{#if mine && trialSeedOf(v) !== (v.settings.seed ?? null)}
									<button
										type="button"
										class="btn btn-sm preset-tonal mt-2"
										disabled={busy}
										onclick={() => keepSeed(v)}
										data-keep-seed
									>
										Keep this seed
									</button>
								{/if}
							</div>
						{/if}
						{#if errorOf(`row:${v.id}`)}
							<p class="text-error-600-400 text-xs" role="alert">
								{errorOf(`row:${v.id}`)}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			</div>
			{/each}
		{/if}
	{/if}
</section>

<VoicebankForm
	open={formOpen}
	entry={editEntry}
	{loadouts}
	initialLoadoutId={presetLoadoutId}
	facts={formFacts}
	{busy}
	onLoadoutChange={onFormLoadout}
	error={errorOf("form")}
	onSave={save}
	onCancel={() => (formOpen = false)}
/>

{#if deleteEntry}
	<Dialog
		open
		closeOnInteractOutside={false}
		onOpenChange={(e) => !e.open && (deleting = null)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				>
					<div
						role="alertdialog"
						aria-labelledby="vb-del-title"
						aria-describedby="vb-del-desc"
					>
						<h2 id="vb-del-title" class="h2 text-lg font-bold">
							Delete {deleteEntry.name}?
						</h2>
						<p id="vb-del-desc" class="text-surface-600-400 mt-2 text-sm">
							The voice entry <span class="font-mono">{deleteEntry.slug}</span>
							goes. Cards and sessions that name it are not
							changed: at speaking time they fall back to the
							default voice. The model's own voices stay.
						</p>
						{#if errorOf("delete")}
							<p class="text-error-600-400 mt-2 text-sm" role="alert">
								{errorOf("delete")}
							</p>
						{/if}
					</div>
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => (deleting = null)}
						>
							Keep {deleteEntry.name}
						</button>
						<button
							type="button"
							class="btn preset-filled-error-500"
							disabled={busy}
							onclick={confirmDelete}
						>
							Delete
						</button>
					</footer>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
