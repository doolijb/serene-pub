<script lang="ts">
	/**
	 * The new-script page: pick the type (grouped by content scope — the type
	 * decides everything: the variable space, the blast radius, where the
	 * script may attach), name it, and Create explicitly — nothing is written
	 * until the button. The response lands you on the new row's change page to
	 * author the source.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	type ScriptType = Sockets.Pipelines.Scripts.ScriptType

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)
	let typeId = $state("")
	let name = $state("")
	/** Ids present before Create — the response's new row is the one not here. */
	let priorIds: Set<number> = new Set()

	let groups = $derived.by(() => {
		const byScope = new Map<string, ScriptType[]>()
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

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on(
			"pipelines:scripts",
			(res: Sockets.Pipelines.Scripts.Response) => {
				view = res
				loading = false
				if (!typeId && res.types?.length) typeId = res.types[0].typeId
			}
		)
		socket.on(
			"pipelines:createScript",
			(res: Sockets.Pipelines.ScriptWrite.Response) => {
				const created = res.scripts?.scripts?.find(
					(s) => !priorIds.has(s.id)
				)
				toaster.success({ title: "Script created" })
				goto(
					created
						? `/admin/scripts/${created.id}`
						: "/admin/scripts"
				)
			}
		)
		socket.on(
			"pipelines:createScript:error",
			(res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			}
		)
		socket.emit("pipelines:scripts", {})
	})

	onDestroy(() => {
		socket.off("pipelines:scripts")
		socket.off("pipelines:createScript")
		socket.off("pipelines:createScript:error")
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

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/scripts" class="hover:underline">Scripts</a>
			/ <strong>New</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SquareCode size={20} /> New script
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/scripts">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !groups.length}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		No script types are registered. Core registers its own at startup, so
		an empty list usually means the type registry refused to sync — check
		the server log for a bootstrap warning.
	</div>
{:else}
	<div class="form-max card preset-filled-surface-100-900 flex flex-col gap-3 p-4 shadow-sm">
		<div class="field-row">
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Type</span>
				<select class="select" bind:value={typeId}>
					{#each groups as [content, list] (content)}
						<optgroup label={scopeLabel(content)}>
							{#each list as t (t.typeId)}
								<option value={t.typeId}>{t.name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
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
						class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[0.68rem]"
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
