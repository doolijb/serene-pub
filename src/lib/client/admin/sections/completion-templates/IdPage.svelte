<script lang="ts">
	/**
	 * Admin › Completion templates › one template: the change form (note 37,
	 * Django admin, on `AdminChangeForm`). Fieldsets: Template (name, key,
	 * offered), Framing (each role's opening and closing), Stop strings, and
	 * the Live preview.
	 *
	 * ## The preview is the point
	 *
	 * Every field on this page is invisible characters. `"### User:\n"` differs
	 * from `"### User:"` by one byte that no text field shows, and that byte
	 * decides whether a model sees a turn boundary. So the editor takes and
	 * shows **escapes** (`\n`, `\t`), and the panel on the right renders a real
	 * block through `PromptBlockFormatter.makeBlock` — the same function the
	 * prompt renderer calls, handed the DRAFT rather than the saved row. What is
	 * on screen is what the model would receive, not an illustration of it.
	 *
	 * ## built-in / custom
	 *
	 * The same two words the list page uses, for the reason stated there.
	 * Built-in rows are read-only: `db/defaults.ts` re-applies their full
	 * contents on every boot, so an edit would be reverted at the next restart
	 * with nothing to catch it. Clone is the way to a variant.
	 */
	import * as Icons from "@lucide/svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField from "$lib/client/components/admin/AdminField.svelte"
	import { deletionFor } from "$lib/client/components/admin/changelist"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
	import {
		BLOCK_ROLES,
		type BlockRole,
		type CompletionTemplate
	} from "$lib/shared/constants/completionTemplates"
	import { validateCompletionTemplate } from "$lib/shared/utils/completionTemplateValidation"
	import { fromEscaped, toEscaped } from "$lib/shared/utils/escapedText"
	import { refreshCompletionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"

	const socket = useTypedSocket()
	const interest = getInterestContext()
	let id = $derived(Number(page.params.id))

	let row = $state<SelectCompletionTemplate | null>(null)
	let loading = $state(true)
	let seeded = $state(false)
	let missing = $state(false)

	// The draft, in ESCAPED form — what the inputs bind to.
	let name = $state("")
	let isSelectable = $state(true)
	// Every role present from the start, not `{}`: the framing grid binds
	// `roles[role].prefix` directly, and a role that is not there yet is a
	// crash rather than an empty field. The load guards below mean it should
	// never render before `seed()`, and "should never" is not a reason to leave
	// a throw one ordering change away.
	let roles = $state<Record<string, { prefix: string; suffix: string }>>(
		Object.fromEntries(
			BLOCK_ROLES.map((r) => [r, { prefix: "", suffix: "" }])
		)
	)
	let fallback = $state({ prefix: "", suffix: "" })

	let readonly = $derived(!!row?.isImmutable)

	function seed(r: SelectCompletionTemplate) {
		name = r.name
		isSelectable = r.isSelectable
		const stored = (r.roles ?? {}) as Record<string, any>
		const fb = r.fallbackRole ?? { prefix: "", suffix: "" }
		fallback = {
			prefix: toEscaped(fb.prefix),
			suffix: toEscaped(fb.suffix)
		}
		roles = Object.fromEntries(
			BLOCK_ROLES.map((role) => [
				role,
				{
					prefix: toEscaped(stored[role]?.prefix ?? fb.prefix),
					suffix: toEscaped(stored[role]?.suffix ?? fb.suffix)
				}
			])
		)
		seeded = true
	}

	/** The draft as the server would store it — escapes decoded. */
	let draft = $derived({
		key: row?.key ?? "",
		name,
		renderMode: "flat" as const,
		roles: Object.fromEntries(
			BLOCK_ROLES.map((role) => [
				role,
				{
					prefix: fromEscaped(roles[role]?.prefix),
					suffix: fromEscaped(roles[role]?.suffix)
				}
			])
		) as Record<BlockRole, { prefix: string; suffix: string }>,
		fallbackRole: {
			prefix: fromEscaped(fallback.prefix),
			suffix: fromEscaped(fallback.suffix)
		},
		stopStrings: (row?.stopStrings ?? []) as string[],
		isSelectable
	})

	/**
	 * The SAME check the handler runs, run here too.
	 *
	 * A courtesy, never the decision: the server refuses regardless, and it has
	 * to, because a socket event does not pass through this component. Showing
	 * it early is what stops "Save" from being a round trip to find out.
	 */
	let problem = $derived(seeded ? validateCompletionTemplate(draft) : null)

	/**
	 * A real block, through the real formatter, from the unsaved draft.
	 *
	 * `makeBlock` accepts a resolved template, which is exactly what the render
	 * path now hands it for a row like this one — so this preview and the prompt
	 * are the same construction rather than two that agree today.
	 */
	function previewBlock(role: BlockRole, content: string): string {
		return PromptBlockFormatter.makeBlock({
			format: draft as CompletionTemplate,
			role,
			content
		})
	}
	let preview = $derived(
		seeded
			? previewBlock("system", "You are Alice, a knight of the watch.") +
					previewBlock("user", "Bob: Where do the riders patrol?") +
					previewBlock("assistant", "Alice: Along the north wall.")
			: ""
	)

	/**
	 * What Save sends, decoded. The saved snapshot is this as BUILT from the
	 * row (`markSaved` after `seed`), so an escape that does not round-trip
	 * byte for byte is not an edit nobody made.
	 */
	const edits = new UnsavedEdits(() => ({
		name: draft.name,
		roles: draft.roles,
		fallbackRole: draft.fallbackRole,
		isSelectable: draft.isSelectable
	}))
	let dirty = $derived(edits.dirty)
	adminUnsavedEdits(() => edits.dirty)

	/** A saved row in the reader's shape: roles filled from the fallback. */
	function savedShapeOf(r: SelectCompletionTemplate) {
		const fb = r.fallbackRole ?? { prefix: "", suffix: "" }
		const stored = (r.roles ?? {}) as Record<string, any>
		return {
			name: r.name,
			roles: Object.fromEntries(
				BLOCK_ROLES.map((role) => [
					role,
					{
						prefix: stored[role]?.prefix ?? fb.prefix ?? "",
						suffix: stored[role]?.suffix ?? fb.suffix ?? ""
					}
				])
			) as Record<BlockRole, { prefix: string; suffix: string }>,
			fallbackRole: { prefix: fb.prefix ?? "", suffix: fb.suffix ?? "" },
			isSelectable: r.isSelectable
		}
	}

	function handleGet(res: Sockets.CompletionTemplates.Get.Response) {
		row = res.completionTemplate
		loading = false
		if (!seeded) {
			seed(res.completionTemplate)
			edits.markSaved()
		}
	}
	function handleGetError(res: { error?: string }) {
		loading = false
		missing = true
		toaster.error({ title: res.error ?? "Completion template not found." })
	}
	function handleUpdate(res: Sockets.CompletionTemplates.Update.Response) {
		if (res.completionTemplate?.id !== id) return
		row = res.completionTemplate
		// The saved row moved: a clean form follows it, and the echo of this
		// form's own save makes it clean.
		edits.adoptSaved(savedShapeOf(res.completionTemplate), () => {
			seed(res.completionTemplate)
		})
		refreshCompletionTemplateOptions()
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		edits.markSaved()
		toaster.success({ title: `Saved ${res.completionTemplate.name}` })
		if (intent === "save") goto("/admin/completion-templates")
		else if (intent === "another") goto(`/admin/completion-templates/new?from=${id}`)
	}
	function handleClone(res: Sockets.CompletionTemplates.Clone.Response) {
		refreshCompletionTemplateOptions()
		toaster.success({ title: "Template cloned" })
		goto(`/admin/completion-templates/${res.completionTemplate.id}`)
	}
	function handleDelete(res: { success?: string }) {
		if (!deleting) return
		deleting = false
		refreshCompletionTemplateOptions()
		if (res.success) toaster.success({ title: res.success })
		edits.forget()
		goto("/admin/completion-templates", { replaceState: true })
	}
	function handleError(res: { error?: string }) {
		if (pendingIntent || deleting) {
			pendingIntent = null
			saving = false
			deleting = false
			formErrors = [res.error ?? "The server refused the edit."]
			return
		}
		toaster.error({ title: res.error ?? "The server refused the edit." })
	}

	/**
	 * This form's eight keys, all BARE and all STANDING — exactly what the
	 * `onMount`/`onDestroy` pair they replace held.
	 *
	 * BARE because `completionTemplates:get` has no entry in `SCOPED_EVENTS`,
	 * so a key naming the id would match no payload at all; the id in the URL
	 * is the only thing that decides which row was asked for. STANDING because
	 * `get` is re-requested by the effect below on every `[id]` change, and the
	 * three writes answer whenever the person presses Save, Clone or Delete.
	 * The four refusals are declared too, and never gated.
	 *
	 * Declared BEFORE the fetch effect below so the keys exist when its first
	 * emit goes out: Svelte runs user effects in creation order.
	 *
	 * The app-wide interest context, not `adminInterest`: `completionTemplates:`
	 * is not a restricted interest family, and the admin gate is the one
	 * `/admin/+layout.svelte` already makes.
	 */
	$effect(() => {
		const releases = [
			interest.declareInterest<"completionTemplates:get">(
				"completionTemplates:get",
				handleGet
			),
			interest.declareInterest<"completionTemplates:get:error">(
				"completionTemplates:get:error",
				handleGetError
			),
			interest.declareInterest<"completionTemplates:update">(
				"completionTemplates:update",
				handleUpdate
			),
			interest.declareInterest<"completionTemplates:update:error">(
				"completionTemplates:update:error",
				handleError
			),
			interest.declareInterest<"completionTemplates:clone">(
				"completionTemplates:clone",
				handleClone
			),
			interest.declareInterest<"completionTemplates:clone:error">(
				"completionTemplates:clone:error",
				handleError
			),
			interest.declareInterest<"completionTemplates:delete">(
				"completionTemplates:delete",
				handleDelete
			),
			interest.declareInterest<"completionTemplates:delete:error">(
				"completionTemplates:delete:error",
				handleError
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * Fetch whenever `id` changes — including on the first render.
	 *
	 * ⚠ SvelteKit reuses this component across `[id]` values, so a navigation
	 * from one template to another (Clone lands on its copy) changes `id`
	 * without remounting. `onMount` would not run again, and the page would
	 * show the previous row's fields under the new row's URL — an editor
	 * pointed at something other than what it says it is editing, which then
	 * SAVES to the id in the URL.
	 *
	 * Declared AFTER the interest effect above so every key is held before the
	 * first emit: Svelte runs user effects in creation order.
	 *
	 * `loadedId` is a plain `let`, deliberately — it is this effect's own
	 * bookkeeping, and making it reactive would have the effect re-run itself.
	 */
	let loadedId: number | null = null
	$effect(() => {
		if (loadedId === id) return
		loadedId = id
		row = null
		seeded = false
		edits.forget()
		loading = true
		missing = false
		socket.emit("completionTemplates:get", { id })
	})

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let deleting = false
	let formErrors = $state<string[]>([])

	function save(intent: AdminSaveIntent) {
		if (!row || problem) return
		formErrors = []
		if (!dirty) {
			if (intent === "save") goto("/admin/completion-templates")
			else if (intent === "another") goto(`/admin/completion-templates/new?from=${id}`)
			return
		}
		saving = true
		pendingIntent = intent
		socket.emit("completionTemplates:update", {
			completionTemplate: {
				id: row.id,
				name: draft.name,
				roles: draft.roles,
				fallbackRole: draft.fallbackRole,
				isSelectable: draft.isSelectable
			} as any
		})
	}
	function clone() {
		if (!row) return
		socket.emit("completionTemplates:clone", { id: row.id })
	}
	function remove() {
		if (!row) return
		deleting = true
		socket.emit("completionTemplates:delete", { id: row.id })
	}
	const deletion = () =>
		deletionFor([row!], {
			noun: { singular: "completion template", plural: "completion templates" },
			label: (r) => r.name,
			consequence: () =>
				"Any connection using it loses its format and renders with the default until one is chosen again"
		})
</script>

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading completion template…
	</div>
{:else if missing || !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no completion template {id}.</p>
		<a href="/admin/completion-templates" class="btn btn-sm preset-tonal-surface">
			All completion templates
		</a>
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		title={name.trim() || row.name}
		purpose={readonly
			? "A built-in template: read-only — every boot re-applies it. Duplicate it to make a variant."
			: undefined}
		noun="completion template"
		changelistHref="/admin/completion-templates"
		changelistLabel="Completion templates"
		{dirty}
		{saving}
		canSave={readonly || !!problem ? false : undefined}
		errors={problem ? [problem, ...formErrors] : formErrors}
		deletion={readonly ? undefined : deletion}
		onDelete={readonly ? undefined : remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={clone}>
				<Icons.Copy size={16} aria-hidden="true" /> Duplicate
			</button>
		{/snippet}
		{#snippet headerExtra()}
			{#if readonly}
				<span class="border-surface-300-700 text-surface-600-400 self-start rounded-full border px-2 py-0.5 text-xs">
					Built-in
				</span>
			{/if}
		{/snippet}

		<div class="editor-grid">
			<div class="flex min-w-0 flex-col gap-3">
				<AdminFieldset title="Template">
					<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
						{#if readonly}
							<AdminField id="ct-admin-name" label="Name" value={name} />
						{:else}
							<AdminField id="ct-admin-name" label="Name" required>
								<input id="ct-admin-name" class="input" type="text" bind:value={name} />
							</AdminField>
						{/if}
						<!-- Always readonly, on every row: it is the target of
						     `connections.prompt_format`'s foreign key, so a rename
						     is a rename of something other rows point at — the
						     server refuses it and says to duplicate instead. -->
						<AdminField
							id="ct-admin-key"
							label="Key"
							value={row.key}
							help="Stored on every connection that selects this template. It cannot change — duplicate under a new key instead."
						/>
					</div>
					<label class="flex min-h-10 items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="checkbox"
							bind:checked={isSelectable}
							disabled={readonly}
						/>
						Offer this template in a connection's format picker
					</label>
				</AdminFieldset>

				<AdminFieldset title="Framing" description="What opens and closes each role's block.">
				<p class="text-surface-600-400 text-xs">
					<strong>Escapes, not characters.</strong>
					Type
					<code>\n</code>
					for a newline and
					<code>\t</code>
					 for a tab — a marker's trailing newline is the byte that separates
					one turn from the next, and no text field shows it otherwise.
				</p>

				<div class="framing-grid text-sm">
					<span class="text-surface-600-400 text-xs font-medium">
						Role
					</span>
					<span class="text-surface-600-400 text-xs font-medium">
						Opens with
					</span>
					<span class="text-surface-600-400 text-xs font-medium">
						Closes with
					</span>
					{#each BLOCK_ROLES as role (role)}
						<span class="self-center font-mono text-xs">
							{role}
						</span>
						<input
							class="input font-mono text-xs"
							aria-label="{role} opening"
							bind:value={roles[role].prefix}
							{readonly}
							spellcheck="false"
						/>
						<input
							class="input font-mono text-xs"
							aria-label="{role} closing"
							bind:value={roles[role].suffix}
							{readonly}
							spellcheck="false"
						/>
					{/each}
					<span
						class="self-center font-mono text-xs"
						title="Used only for a role outside the six above — reachable from an untyped caller."
					>
						fallback
					</span>
					<input
						class="input font-mono text-xs"
						aria-label="fallback opening"
						bind:value={fallback.prefix}
						{readonly}
						spellcheck="false"
					/>
					<input
						class="input font-mono text-xs"
						aria-label="fallback closing"
						bind:value={fallback.suffix}
						{readonly}
						spellcheck="false"
					/>
				</div>
				</AdminFieldset>

				<AdminFieldset title="Stop strings">
				<code class="text-surface-700-300 text-xs break-all">
					{(row.stopStrings ?? []).length
						? (row.stopStrings as string[]).join("  ·  ")
						: "—"}
				</code>
				<!-- ⚠ Read-only, and said plainly rather than offered as a
				     control that would not do anything. The send path reads the
				     resolved ROW, and `connections/stops.ts` composes from it
				     (ruling 2026-09-10) — so this list is what a
				     completion-wire request stops on. Only the editor is
				     missing. -->
				<span class="text-surface-600-400 text-xs">
					Shown as the row carries them. These are what a request in
					text-completion mode stops on, alongside the speaker labels
					for the scene and any stop sequences set on the step; in
					chat mode they are held back, because a chat request
					contains none of these markers. Not editable here yet.
				</span>
				</AdminFieldset>
			</div>

			<AdminFieldset
				title="Live preview"
				description="Three blocks, wrapped by this draft through the same formatter the prompt renderer uses. Unsaved edits show here immediately."
			>
				<pre
					class="bg-surface-50-950 max-h-[28rem] overflow-auto rounded-[10px] p-2 font-mono text-xs whitespace-pre-wrap">{preview}</pre>
			</AdminFieldset>
		</div>
	</AdminChangeForm>
{/if}

<style>
	.editor-grid {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 1fr);
	}
	/* Beside each other only when the change form itself has room: the
	   section pane is the `content` container. */
	@container content (min-width: 1000px) {
		.editor-grid {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			align-items: start;
		}
	}
	.framing-grid {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.35rem 0.5rem;
		align-items: center;
	}
</style>
