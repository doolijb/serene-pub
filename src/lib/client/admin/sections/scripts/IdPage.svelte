<script lang="ts">
	/**
	 * Admin › Scripts › one script (18 §4d, §6a): the change form (note 37,
	 * Django admin). Everything is a draft — name, enabled, the declared I/O
	 * and the source — landing in one explicit Save. Fieldsets:
	 *
	 * - **Script** — name, enabled; type and scope readonly, with what the
	 *   type is able to do.
	 * - **Declarations** — Reads and Rewrites, chosen from a **fixed** set,
	 *   never typed (ruled 2026-08-23): reads offer the type's in-ports plus
	 *   the extras some hook supplies; rewrites offer the out-ports. They are
	 *   the audit surface — a person checking a chain reads these, not the
	 *   source. A verdict type has no outs: its return is consumed by the hook.
	 * - **Source**.
	 * - **Chains** (inline) — the pipelines whose chains include it.
	 *
	 * Built-in scripts are read-only; Duplicate clones one. Delete asks on the
	 * confirmation page; a chained script is kept (the server refuses).
	 * Export downloads this script as a pack — this page owns that download
	 * while it is on screen (the changelist owns it otherwise).
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import AdminInline from "$lib/client/components/admin/AdminInline.svelte"
	import { scriptDeletion } from "./scriptsAdmin"

	type Script = Sockets.Pipelines.Scripts.Script
	type ScriptKind = Sockets.Pipelines.Scripts.ScriptKind
	type Draft = Pick<Script, "name" | "source" | "enabled" | "varsIn" | "varsOut">

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const id = $derived(Number(adminPage.params.id))

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)
	const row = $derived((view.scripts ?? []).find((s) => s.id === id))
	const type = $derived<ScriptKind | undefined>(
		(view.types ?? []).find((t) => t.typeId === row?.typeId)
	)
	const readOnly = $derived(!!row?.isImmutable)

	const toDraft = (r: Script): Draft => ({
		name: r.name,
		source: r.source,
		enabled: r.enabled,
		varsIn: [...r.varsIn],
		varsOut: [...r.varsOut]
	})
	let draft = $state<Draft | undefined>(undefined)
	// The declarations are sets: ticking in another order is no edit.
	const edits = new UnsavedEdits(() => draft, { unordered: ["varsIn", "varsOut"] })
	adminUnsavedEdits(() => edits.dirty)
	$effect(() => {
		if (loading || !row) return
		const next = toDraft(row)
		untrack(() => {
			if (draft === undefined) {
				draft = next
				edits.markSaved()
			} else edits.adoptSaved(next, (d) => (draft = d))
		})
	})

	/** Reads: the type's in-ports plus supplied extras. Writes: out-ports. */
	const readChoices = $derived(
		type ? [...type.varsIn, ...type.extras.filter((e) => !type!.varsIn.includes(e))] : []
	)
	function toggleVar(which: "varsIn" | "varsOut", value: string) {
		if (readOnly || !draft) return
		const list = draft[which]
		draft[which] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
	}

	// ── socket wiring ───────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let deleting = false
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	function handleUpdate(res: Sockets.Pipelines.ScriptWrite.Response) {
		if (res.scripts) view = res.scripts
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		const saved = res.scripts?.scripts?.find((s) => s.id === id)
		if (saved) {
			draft = toDraft(saved)
			edits.markSaved()
		}
		toaster.success({ title: `Saved ${saved?.name ?? "the script"}` })
		land(intent)
	}
	function handleUpdateError(res: { error?: string }) {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = res.error ?? "The script was not saved."
		if (/name/i.test(error)) nameError = error
		else formErrors = [error]
	}
	function handleClone(res: Sockets.Pipelines.ScriptWrite.Response) {
		if (res.scripts) view = res.scripts
	}
	function handleDelete(res: Sockets.Pipelines.ScriptWrite.Response) {
		if (res.scripts) view = res.scripts
		if (!deleting) return
		deleting = false
		edits.forget()
		toaster.success({ title: "Script deleted" })
		void adminGoto("/admin/scripts", { replaceState: true })
	}
	function handleError(res: { error?: string }) {
		if (deleting) {
			deleting = false
			formErrors = [res.error ?? "The script was not deleted."]
		} else if (res.error) toaster.error({ title: res.error })
	}
	function handleExport(res: Sockets.Pipelines.ScriptShare.ExportResponse) {
		if (res.blob && res.filename) downloadBlob(res as { blob: unknown; filename: string })
	}

	/**
	 * The row, asked for and listened for in one; the writes and their
	 * refusals stand — each arrives when the person presses a button. All
	 * BARE: a script is not one session's anything. The app-wide registry:
	 * `pipelines:` is a mixed family; every handler checks admin again.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			declareInterest<"pipelines:updateScript">("pipelines:updateScript", handleUpdate),
			declareInterest<"pipelines:updateScript:error">("pipelines:updateScript:error", handleUpdateError),
			declareInterest<"pipelines:cloneScript">("pipelines:cloneScript", handleClone),
			declareInterest<"pipelines:cloneScript:error">("pipelines:cloneScript:error", handleError),
			declareInterest<"pipelines:deleteScript">("pipelines:deleteScript", handleDelete),
			declareInterest<"pipelines:deleteScript:error">("pipelines:deleteScript:error", handleError),
			declareInterest<"pipelines:exportScripts">("pipelines:exportScripts", handleExport),
			declareInterest<"pipelines:exportScripts:error">("pipelines:exportScripts:error", handleError),
			requestWithInterest("pipelines:scripts", {}, (res) => {
				view = res
				loading = false
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function save(intent: AdminSaveIntent) {
		if (!draft || !row || readOnly) return
		const name = draft.name.trim()
		nameError = name ? null : "A script needs a name."
		formErrors = []
		if (nameError) return
		draft.name = name
		if (!edits.dirty) return land(intent)
		saving = true
		pendingIntent = intent
		socket.emit("pipelines:updateScript", { id, ...$state.snapshot(draft) })
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void adminGoto("/admin/scripts")
		else if (intent === "another") void adminGoto("/admin/scripts/new")
	}
	function remove() {
		if (!row || readOnly) return
		deleting = true
		socket.emit("pipelines:deleteScript", { id })
	}
	function duplicate() {
		socket.emit("pipelines:cloneScript", { id })
		toaster.success({ title: "Script duplicated" })
		void adminGoto("/admin/scripts")
	}

	const title = $derived(draft?.name.trim() || row?.name || "Script")
</script>

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading script…
	</div>
{:else if !row || !draft}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no script {id}.</p>
		<a href="/admin/scripts" class="btn btn-sm preset-tonal-surface">All scripts</a>
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		{title}
		purpose={readOnly
			? "A built-in script: read-only. Duplicate it to make one you can change."
			: type?.description}
		noun="script"
		changelistHref="/admin/scripts"
		changelistLabel="Scripts"
		dirty={edits.dirty}
		{saving}
		canSave={readOnly ? false : undefined}
		errors={formErrors}
		fieldErrors={{ "script-admin-name": nameError }}
		deletion={readOnly ? undefined : () => scriptDeletion([row!])}
		onDelete={readOnly ? undefined : remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => socket.emit("pipelines:exportScripts", { ids: [id] })}
			>
				<Icons.Download size={16} aria-hidden="true" /> Export
			</button>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={duplicate}>
				<Icons.Copy size={16} aria-hidden="true" /> Duplicate
			</button>
		{/snippet}
		{#snippet headerExtra()}
			{#if type}
				<div class="flex flex-wrap items-center gap-1.5 text-xs">
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						{type.name}
					</span>
					<span
						class="preset-tonal-warning rounded-full px-2 py-0.5"
						title="What a script of this type is able to do"
					>
						{type.blastRadius}
					</span>
					{#if readOnly}
						<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
							Built-in
						</span>
					{/if}
				</div>
			{/if}
		{/snippet}

		<AdminFieldset title="Script">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-3">
				{#if readOnly}
					<AdminField id="script-admin-name" label="Name" value={draft.name} />
				{:else}
					<AdminField id="script-admin-name" label="Name" required error={nameError}>
						<input
							id="script-admin-name"
							class="input"
							type="text"
							bind:value={draft.name}
							aria-invalid={!!nameError}
							aria-describedby={describedBy("script-admin-name", !!nameError)}
						/>
					</AdminField>
				{/if}
				<AdminField
					id="script-admin-type"
					label="Type"
					value={type ? `${type.name} (${type.typeId})` : row.typeId}
				/>
				<AdminField
					id="script-admin-enabled"
					label="Status"
					help="A disabled script keeps its place in every chain and does nothing."
				>
					<label class="flex min-h-10 items-center gap-2 text-sm">
						<input
							id="script-admin-enabled"
							type="checkbox"
							class="checkbox"
							bind:checked={draft.enabled}
							disabled={readOnly}
							aria-describedby={describedBy("script-admin-enabled", false)}
						/>
						Enabled
					</label>
				</AdminField>
			</div>
		</AdminFieldset>

		{#if type}
			<AdminFieldset
				title="Declarations"
				description="What the script reads and may rewrite — the part a person checking a chain reads. In but not out is read-only."
			>
				<div class="flex flex-col gap-1.5 text-sm">
					<span class="font-medium">Reads</span>
					<div class="flex flex-wrap gap-1.5" role="group" aria-label="Reads">
						{#each readChoices as v (v)}
							<button
								type="button"
								class="chip min-h-8 rounded-full px-3 text-xs {draft.varsIn.includes(v)
									? 'preset-tonal-primary'
									: 'preset-tonal-surface'}"
								aria-pressed={draft.varsIn.includes(v)}
								disabled={readOnly}
								onclick={() => toggleVar("varsIn", v)}
							>
								{v}
							</button>
						{/each}
					</div>
				</div>
				{#if type.varsOut.length}
					<div class="flex flex-col gap-1.5 text-sm">
						<span class="font-medium">Rewrites</span>
						<div class="flex flex-wrap gap-1.5" role="group" aria-label="Rewrites">
							{#each type.varsOut as v (v)}
								<button
									type="button"
									class="chip min-h-8 rounded-full px-3 text-xs {draft.varsOut.includes(v)
										? 'preset-tonal-primary'
										: 'preset-tonal-surface'}"
									aria-pressed={draft.varsOut.includes(v)}
									disabled={readOnly}
									onclick={() => toggleVar("varsOut", v)}
								>
									{v}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<p class="text-surface-600-400 text-xs">
						A verdict type rewrites nothing — its return is consumed by the hook.
					</p>
				{/if}
			</AdminFieldset>
		{/if}

		<AdminFieldset title="Source">
			<AdminField id="script-admin-source" label="Source">
				<textarea
					id="script-admin-source"
					class="textarea w-full font-mono text-xs"
					rows={16}
					readonly={readOnly}
					spellcheck="false"
					bind:value={draft.source}
				></textarea>
			</AdminField>
		</AdminFieldset>

		<AdminInline
			title="Chains"
			description="The pipelines whose chains include this script."
			rows={row.usedBy}
			rowKey={(name) => name}
			columns={[{ key: "name", label: "Pipeline", primary: true, text: (name) => name }]}
			emptyMessage="No chain uses this script yet."
		/>
	</AdminChangeForm>
{/if}
