<script lang="ts">
	/**
	 * One completion template's change form.
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
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
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

	let dirty = $derived(
		seeded &&
			!!row &&
			JSON.stringify({
				name: draft.name,
				roles: draft.roles,
				fallbackRole: draft.fallbackRole,
				isSelectable: draft.isSelectable
			}) !==
				JSON.stringify({
					name: row.name,
					roles: Object.fromEntries(
						BLOCK_ROLES.map((r) => [
							r,
							{
								prefix:
									(row!.roles as any)?.[r]?.prefix ??
									row!.fallbackRole?.prefix ??
									"",
								suffix:
									(row!.roles as any)?.[r]?.suffix ??
									row!.fallbackRole?.suffix ??
									""
							}
						])
					),
					fallbackRole: {
						prefix: row.fallbackRole?.prefix ?? "",
						suffix: row.fallbackRole?.suffix ?? ""
					},
					isSelectable: row.isSelectable
				})
	)

	function handleGet(res: Sockets.CompletionTemplates.Get.Response) {
		row = res.completionTemplate
		loading = false
		if (!seeded) seed(res.completionTemplate)
	}
	function handleGetError(res: { error?: string }) {
		loading = false
		missing = true
		toaster.error({ title: res.error ?? "Completion template not found." })
	}
	function handleUpdate(res: Sockets.CompletionTemplates.Update.Response) {
		row = res.completionTemplate
		refreshCompletionTemplateOptions()
		toaster.success({ title: "Template saved" })
	}
	function handleClone(res: Sockets.CompletionTemplates.Clone.Response) {
		refreshCompletionTemplateOptions()
		toaster.success({ title: "Template cloned" })
		goto(`/admin/completion-templates/${res.completionTemplate.id}`)
	}
	function handleDelete(res: { success?: string }) {
		refreshCompletionTemplateOptions()
		if (res.success) toaster.success({ title: res.success })
		goto("/admin/completion-templates")
	}
	function handleError(res: { error?: string }) {
		toaster.error({ title: res.error ?? "The server refused the edit." })
	}

	onMount(() => {
		socket.on("completionTemplates:get", handleGet)
		socket.on("completionTemplates:get:error", handleGetError)
		socket.on("completionTemplates:update", handleUpdate)
		socket.on("completionTemplates:update:error", handleError)
		socket.on("completionTemplates:clone", handleClone)
		socket.on("completionTemplates:clone:error", handleError)
		socket.on("completionTemplates:delete", handleDelete)
		socket.on("completionTemplates:delete:error", handleError)
	})
	onDestroy(() => {
		socket.off("completionTemplates:get", handleGet)
		socket.off("completionTemplates:get:error", handleGetError)
		socket.off("completionTemplates:update", handleUpdate)
		socket.off("completionTemplates:update:error", handleError)
		socket.off("completionTemplates:clone", handleClone)
		socket.off("completionTemplates:clone:error", handleError)
		socket.off("completionTemplates:delete", handleDelete)
		socket.off("completionTemplates:delete:error", handleError)
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
	 * Declared AFTER `onMount` so the listeners are registered before the first
	 * emit: Svelte runs user effects in creation order, and `onMount` is one.
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
		loading = true
		missing = false
		socket.emit("completionTemplates:get", { id })
	})

	function save() {
		if (!row || problem) return
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
		if (
			!confirm(
				`Delete '${row.name}'? Any connection using it loses its format ` +
					`and renders with the default until one is chosen again.`
			)
		)
			return
		socket.emit("completionTemplates:delete", { id: row.id })
	}
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/completion-templates" class="hover:underline"
				>Completion templates</a
			>
			/ <strong>{row?.name ?? "…"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Brackets size={20} />
			{row?.name ?? "Completion template"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
				>
					built-in · read-only
				</span>
			{/if}
		</h2>
	</div>
	<a
		class="btn btn-sm preset-tonal-surface"
		href="/admin/completion-templates"
	>
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if missing || !row}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This completion template no longer exists.
		<a class="underline" href="/admin/completion-templates">
			Back to the list
		</a>
		.
	</div>
{:else}
	<div class="editor-grid">
		<div
			class="card preset-filled-surface-100-900 flex flex-col gap-3 p-4 shadow-sm"
		>
			<div class="flex flex-wrap gap-3">
				<label class="flex min-w-48 flex-1 flex-col gap-1 text-sm">
					<span class="font-medium">Name</span>
					<input class="input" bind:value={name} {readonly} />
				</label>
				<label class="flex min-w-48 flex-1 flex-col gap-1 text-sm">
					<span class="font-medium">Key</span>
					<!-- Always read-only, on every row. It is the target of
					     `connections.prompt_format`'s foreign key, so a rename
					     is a rename of something other rows are pointing at —
					     the server refuses it and says to clone instead. -->
					<input class="input" value={row.key} readonly />
					<span class="text-surface-600-400 text-xs">
						Stored on every connection that selects this template.
						It cannot change — clone under a new key instead.
					</span>
				</label>
			</div>

			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					bind:checked={isSelectable}
					disabled={readonly}
				/>
				<span>Offer this template in a connection's format picker</span>
			</label>

			<div class="border-surface-500/30 flex flex-col gap-2 border-t pt-3">
				<p class="text-surface-600-400 text-xs">
					<strong>Escapes, not characters.</strong>
					Type <code>\n</code>
					for a newline and <code>\t</code> for a tab — a marker's trailing
					newline is the byte that separates one turn from the next, and
					no text field shows it otherwise.
				</p>

				<div class="framing-grid text-sm">
					<span class="text-surface-600-400 text-xs font-medium"
						>Role</span
					>
					<span class="text-surface-600-400 text-xs font-medium"
						>Opens with</span
					>
					<span class="text-surface-600-400 text-xs font-medium"
						>Closes with</span
					>
					{#each BLOCK_ROLES as role (role)}
						<span class="self-center font-mono text-xs">{role}</span
						>
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
						>fallback</span
					>
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
			</div>

			<div class="border-surface-500/30 flex flex-col gap-1 border-t pt-3">
				<span class="text-sm font-medium">Stop strings</span>
				<code class="text-surface-700-300 text-xs break-all">
					{(row.stopStrings ?? []).length
						? (row.stopStrings as string[]).join("  ·  ")
						: "—"}
				</code>
				<!-- ⚠ Read-only, and said plainly rather than offered as a
				     control that would not do anything. The reason it once gave
				     is GONE: the send path used to resolve stop strings from the
				     format KEY against the built-ins, so a row's own list was
				     not consulted for a template that is not one of the eight.
				     It reads the resolved ROW now, and `connections/stops.ts`
				     composes from it (ruling 2026-09-10) — so this list really
				     is what a completion-wire request stops on. What is still
				     missing is only the editor. -->
				<span class="text-surface-600-400 text-xs">
					Shown as the row carries them. These are what a request in
					text-completion mode stops on, alongside the speaker labels
					for the scene and any stop sequences set on the step; in chat
					mode they are held back, because a chat request contains none
					of these markers. Not editable here yet.
				</span>
			</div>

			{#if problem}
				<p class="preset-tonal-error rounded p-2 text-xs">
					{problem}
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				{#if !readonly}
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!dirty || !!problem}
						onclick={save}
					>
						<Icons.Save size={14} /> Save
					</button>
				{/if}
				<div class="flex-1"></div>
				<button class="btn btn-sm preset-tonal-surface" onclick={clone}>
					<Icons.Copy size={14} /> Clone
				</button>
				{#if !readonly}
					<button
						class="btn btn-sm preset-tonal-error"
						onclick={remove}
					>
						<Icons.Trash2 size={14} /> Delete
					</button>
				{/if}
			</div>
		</div>

		<div
			class="card preset-filled-surface-100-900 flex flex-col gap-2 p-4 shadow-sm"
		>
			<h3 class="flex items-center gap-2 text-sm font-semibold">
				<Icons.Eye size={16} /> Live preview
			</h3>
			<p class="text-surface-600-400 text-xs">
				Three blocks, wrapped by this draft through the same formatter
				the prompt renderer uses. Unsaved edits show here immediately.
			</p>
			<pre
				class="bg-surface-200-800 max-h-[28rem] overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">{preview}</pre>
		</div>
	</div>
{/if}

<style>
	.editor-grid {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 1fr);
		max-width: 76rem;
	}
	@media (min-width: 60rem) {
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
