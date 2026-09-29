<script lang="ts">
	/**
	 * The new-script page: pick the type (grouped by content scope — the type
	 * decides everything: the variable space, the blast radius, where the
	 * script may attach), name it, and Create explicitly — nothing is written
	 * until the button. The response lands you on the new row's change page to
	 * author the source.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"

	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)

	type ScriptKind = Sockets.Pipelines.Scripts.ScriptKind

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)
	let typeId = $state("")
	let name = $state("")
	/** Ids present before Create — the response's new row is the one not here. */
	let priorIds: Set<number> = new Set()

	/** A typed name is what leaving would lose; the type picker opens on a default. */
	const edits = new UnsavedEdits(() => name.trim())
	edits.markSaved("")
	adminUnsavedEdits(() => edits.dirty)

	let groups = $derived.by(() => {
		const byScope = new Map<string, ScriptKind[]>()
		for (const t of view.types ?? []) {
			const list = byScope.get(t.content) ?? []
			list.push(t)
			byScope.set(t.content, list)
		}
		return [...byScope.entries()]
	})
	let selected = $derived(
		(view.types ?? []).find((t) => t.typeId === typeId)
	)

	const scopeLabel = (content: string) =>
		content.charAt(0).toUpperCase() + content.slice(1)

	function handlePipelinesScripts(res: Sockets.Pipelines.Scripts.Response) {
		view = res
		loading = false
		if (!typeId && res.types?.length) typeId = res.types[0].typeId
	}

	function handlePipelinesCreateScript(
		res: Sockets.Pipelines.ScriptWrite.Response
	) {
		const created = res.scripts?.scripts?.find(
			(s) => !priorIds.has(s.id)
		)
		toaster.success({ title: "Script created" })
		edits.forget()
		goto(
			created
				? `/admin/scripts/${created.id}`
				: "/admin/scripts"
		)
	}

	function handlePipelinesCreateScriptError(res: { error?: string }) {
		if (res.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
	})

	/**
	 * The type list, asked for and listened for in one; the create answer
	 * stands, because it comes back when the button is pressed rather than in
	 * reply to anything asked here. BARE, both: a script type is not one
	 * session's anything.
	 *
	 * The app-wide registry, not `adminInterest`: `pipelines:` is a MIXED
	 * family — most of its handlers answer every user — so these are ordinary
	 * keys, and the admin check here is the same one the redirect above makes.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			declareInterest<"pipelines:createScript">(
				"pipelines:createScript",
				handlePipelinesCreateScript
			),
			declareInterest<"pipelines:createScript:error">(
				"pipelines:createScript:error",
				handlePipelinesCreateScriptError
			),
			requestWithInterest("pipelines:scripts", {}, handlePipelinesScripts)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function create() {
		if (!typeId) return
		priorIds = new Set((view.scripts ?? []).map((s) => s.id))
		socket.emit("pipelines:createScript", {
			typeId,
			name: name.trim() || undefined
		})
	}
</script>

{#if split?.mode !== "desk"}
	<a
		class="text-surface-600-400 hover:text-surface-800-200 mb-3 inline-flex items-center gap-1 text-[13px]"
		href="/admin/scripts"
	>
		<Icons.ChevronLeft size={14} /> Back to scripts
	</a>
{/if}
<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<h2
			class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
		>
			New script
		</h2>
	</div>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !groups.length}
	<div
		class="panel-card text-surface-600-400 text-center text-sm"
	>
		No script types are registered. Core registers its own at startup, so
		an empty list usually means the type registry refused to sync — check
		the server log for a bootstrap warning.
	</div>
{:else}
	<div class="form-max panel-card flex flex-col gap-3">
		<div class="field-row">
			<Select
				class="text-sm"
				label="Type"
				options={groups.flatMap(([content, list]) =>
					list.map((t) => ({
						value: t.typeId,
						label: t.name,
						group: scopeLabel(content)
					}))
				)}
				bind:value={typeId}
			/>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Name</span>
				<input
					class="input"
					bind:value={name}
					placeholder="Optional — a default is assigned"
				/>
			</label>
		</div>

		{#if selected}
			<div class="text-surface-600-400 text-xs">
				{#if selected.description}
					<p>{selected.description}</p>
				{/if}
				<p class="mt-1">
					<span
						class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[11px]"
						>{selected.blastRadius}</span
					>
					· reads {[...selected.varsIn, ...selected.extras].join(
						", "
					) || "—"} · rewrites {selected.varsOut.join(", ") || "—"}
				</p>
			</div>
		{/if}

		<div class="flex items-center gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!typeId}
				onclick={create}
			>
				<Icons.Plus size={14} /> Create
			</button>
			<p class="text-surface-600-400 text-xs">
				You'll land on the script's page to author the source.
			</p>
		</div>
	</div>
{/if}

<style>
	.form-max {
		max-width: 48rem;
	}
	.field-row {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@container content (min-width: 640px) {
		.field-row {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
