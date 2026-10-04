<script lang="ts">
	import { getContext } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { v4 as uuid } from "uuid"
	import { toaster } from "$lib/client/utils/toaster"
	import { attachLorebookToSession } from "$lib/client/utils/attachLorebookToSession"
	import FileDropzone from "$lib/client/components/FileDropzone.svelte"
	import NewLorebookDialog from "$lib/client/components/lorebookForms/NewLorebookDialog.svelte"
	import ImportConflictModal from "$lib/client/components/modals/ImportConflictModal.svelte"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import { lorebookFileTooLarge } from "$lib/shared/imports/fileCaps"
	import { copyName } from "./bookCopy"
	import { describeOverwriteLosses } from "./overwriteLosses"
	import { lorebookImportedToast } from "./lorebookImportedToast"

	/**
	 * Everything that happens to a lorebook as a whole — create, import,
	 * copy, delete — with its modals and the socket traffic they need. The
	 * workspace decides *when* one of these opens; what each one then does
	 * lives here, so the workspace is about navigation and nothing else.
	 *
	 * ⚠ Every reply here is BARE and `emitToUser` reaches every tab the person
	 * has open, so each handler acts only on the request THIS component made
	 * (a pending flag set when it emitted). Another tab's import must not open
	 * a conflict prompt here, toast here, or move this reader.
	 *
	 * Export is DISABLED (owner ruling 2026-09-28): the action stays visible
	 * but disabled where it is offered, with `LOREBOOK_EXPORT_PAUSED` as the
	 * reason. `exportingId` is kept only so a surface that still sets it gets
	 * that sentence instead of a file.
	 */
	interface Props {
		creating: boolean
		importing: boolean
		exportingId: number | null
		deletingId: number | null
		/**
		 * The book being copied, and what it is called.
		 *
		 * The name travels with the id because the prompt is pre-filled with
		 * the copy's suggested name, and this component holds no list of books
		 * to look one up in.
		 */
		duplicating: { id: number; name: string } | null
		/** Hidden rather than disabled when the checkbox would do nothing. */
		canOfferAttachToSession: boolean
		/** So a book that is open can be left when it stops existing. */
		onDeleted?: (id: number) => void
		/** So the copy is what the workspace is looking at afterwards. */
		onDuplicated?: (id: number) => void
		/** So a book this tab just made is what the workspace opens. */
		onCreated?: (id: number) => void
		/**
		 * So a book this tab just imported (or the existing one an unchanged
		 * file matched) is what the workspace opens.
		 */
		onImported?: (id: number) => void
	}

	let {
		creating = $bindable(false),
		importing = $bindable(false),
		exportingId = $bindable(null),
		deletingId = $bindable(null),
		duplicating = $bindable(null),
		canOfferAttachToSession,
		onDeleted,
		onDuplicated,
		onCreated,
		onImported
	}: Props = $props()

	const socket = useTypedSocket()
	const openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")

	/**
	 * The file chosen for import: its text, sent as it was read (the server
	 * measures, normalizes and parses it), the name it gives the book, and
	 * the name the dialog shows — the only thing the person edits.
	 */
	let importingBook:
		| { text: string; fileName: string; name: string }
		| undefined = $state(undefined)
	let importConflict:
		| Sockets.Lorebooks.Import.Response["conflict"]
		| undefined = $state(undefined)
	let showImportConflictModal: boolean = $state(false)

	/**
	 * Whether the create in flight should attach the new book to the open
	 * session (the user ticked "attach to this session").
	 */
	let pendingAttach: boolean = $state(false)

	/**
	 * The `requestId` of the create this tab sent, until it is answered. The
	 * server echoes it on the `lorebooks:create` broadcast, so a same-named
	 * create from another tab or surface is never taken for this one's (plan
	 * B8 — this matched on the name before).
	 */
	let pendingCreateRequestId: string | null = $state(null)
	/** Set while this tab has an import or import-resolve in flight. */
	let importPending: boolean = $state(false)
	/** The book this tab asked to delete, until the server answers. */
	let pendingDeleteId: number | null = $state(null)

	/** What the copy will be called, as the reader may still edit it. */
	let duplicateName: string = $state("")
	/** A copy of a large book takes a moment, so the button says it is working. */
	let duplicatePending: boolean = $state(false)

	// Export is paused: a surface that still asks for it gets the reason, and
	// nothing is sent.
	$effect(() => {
		if (exportingId === null) return
		exportingId = null
		toaster.info({ title: LOREBOOK_EXPORT_PAUSED })
	})

	// The suggestion follows the book being copied and nothing else: a
	// keystroke in the box changes `duplicateName` alone, so what the reader
	// types is never overwritten by the name they started from.
	$effect(() => {
		const book = duplicating
		if (!book) return
		duplicateName = copyName(book.name)
		duplicatePending = false
	})

	function handleCreateConfirm(details: {
		name: string
		attachToSession: boolean
	}) {
		if (!details.name.trim()) return
		creating = false
		const trimmed = details.name.trim()
		// Only claim the create when the switch was both shown and on;
		// `attachToSession` is meaningless if the modal rendered no switch.
		pendingAttach = details.attachToSession && canOfferAttachToSession
		pendingCreateRequestId = uuid()
		const req: Sockets.Lorebooks.Create.Params = {
			name: trimmed,
			requestId: pendingCreateRequestId
		}
		socket.emit("lorebooks:create", req)
	}

	/**
	 * The book's name as the file states it, wherever the file keeps it — the
	 * same lookup the server's reader makes (a whole card's `character_book`
	 * first), so the dialog shows the name the book would get.
	 */
	function nameInFile(json: any): string {
		const book = json?.character_book ?? json?.data?.character_book ?? json
		return typeof book?.name === "string" ? book.name : ""
	}

	function handleFileImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		const file = details.files[0]

		if (file.type !== "application/json") {
			toaster.error({
				title: "Invalid file type. Please upload a JSON file."
			})
			return
		}
		// The server's own ceiling, said before a byte is read or sent.
		const tooLarge = lorebookFileTooLarge(file.size)
		if (tooLarge) {
			toaster.error({ title: tooLarge })
			return
		}

		const reader = new FileReader()
		reader.onload = function (e) {
			const text = e.target?.result as string
			let name: string
			try {
				name = nameInFile(JSON.parse(text))
			} catch {
				toaster.error({
					title: "This lorebook file isn't valid JSON, so Serene Pub can't read it."
				})
				return
			}
			importingBook = { text, fileName: name, name }
		}
		reader.readAsText(file)
	}

	function handleImportConfirm() {
		if (importingBook && importingBook.name?.trim()) {
			const name = importingBook.name.trim()
			const req: Sockets.Lorebooks.Import.Params = {
				lorebookJson: importingBook.text,
				// Only a changed name travels, so an untouched re-import of a
				// book still reads as unchanged.
				...(name !== importingBook.fileName.trim() ? { name } : {})
			}
			importPending = true
			socket.emit("lorebooks:import", req)
			importing = false
			importingBook = undefined
		}
	}

	function handleOverwriteImportConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "overwrite",
			heldImportId: importConflict.heldImportId,
			existingId: importConflict.existingLorebook.id
		}
		importPending = true
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	function handleImportAsNewFromConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "createNew",
			heldImportId: importConflict.heldImportId,
			existingId: importConflict.existingLorebook.id
		}
		importPending = true
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	/**
	 * Asks; the toast and leaving the open book wait for the server's answer
	 * (finding #84) — a refused delete leaves the book where it was, and the
	 * catch-all says why.
	 */
	function handleDeleteConfirm() {
		if (deletingId === null) return
		const id = deletingId
		const req: Sockets.Lorebooks.Delete.Params = { id }
		pendingDeleteId = id
		socket.emit("lorebooks:delete", req)
		deletingId = null
	}

	function handleDuplicateConfirm() {
		if (!duplicating || duplicatePending) return
		duplicatePending = true
		socket.emit("lorebooks:duplicate", {
			lorebookId: duplicating.id,
			name: duplicateName.trim() || copyName(duplicating.name)
		} satisfies Sockets.Lorebooks.Duplicate.Params)
	}

	/**
	 * The copy landed.
	 *
	 * ⚠ Only for a copy this component asked for. The channel is the user's
	 * rather than this prompt's, and opening a book somebody else's surface
	 * made would move the reader out of what they were doing. Closing the
	 * prompt does not cancel the ask: the copy is being made either way, so
	 * the answer still says so and still opens it.
	 */
	function handleLorebooksDuplicate(
		msg: Sockets.Lorebooks.Duplicate.Response
	) {
		if (!msg.lorebook || !duplicatePending) return
		duplicating = null
		duplicatePending = false
		toaster.success({
			title: "Lorebook duplicated",
			description: `"${msg.lorebook.name}" is ready.`
		})
		onDuplicated?.(msg.lorebook.id)
	}

	/**
	 * The copy was refused.
	 *
	 * No toast of its own: `lorebooks:duplicate:error` is not in Layout's
	 * handled set, so the generic listener there already says what went wrong.
	 * This exists so the prompt stops claiming to be working and the reader
	 * can try again or close it.
	 */
	function handleLorebooksDuplicateError() {
		duplicatePending = false
	}

	function handleLorebooksCreate(msg: Sockets.Lorebooks.Create.Response) {
		if (!msg.lorebook) return
		// Only this tab's own create, by the id it sent.
		if (
			pendingCreateRequestId === null ||
			msg.requestId !== pendingCreateRequestId
		)
			return
		pendingCreateRequestId = null
		const attach = pendingAttach
		pendingAttach = false
		toaster.success({
			title: "Lorebook created",
			description: `"${msg.lorebook.name}" created successfully.`
		})
		// Server automatically emits updated list
		if (attach && openSessionCtx.sessionId !== null) {
			attachLorebookToSession(
				socket,
				openSessionCtx.sessionId,
				msg.lorebook.id
			)
		}
		onCreated?.(msg.lorebook.id)
	}

	function handleLorebooksImport(msg: Sockets.Lorebooks.Import.Response) {
		if (!importPending) return
		importPending = false
		if (msg.status === "conflict" && msg.conflict) {
			importConflict = msg.conflict
			showImportConflictModal = true
			return
		}
		if (msg.status === "unchanged") {
			toaster.success({
				title: "Already imported",
				description: `"${msg.lorebook?.name}" is unchanged. Opening the lorebook you already have.`
			})
			if (msg.lorebook) onImported?.(msg.lorebook.id)
			return
		}
		const toast = lorebookImportedToast(msg.warnings)
		toaster[toast.kind]({ title: toast.title, description: toast.description })
		if (msg.lorebook) onImported?.(msg.lorebook.id)
	}

	/**
	 * Toasted here, for this tab's request only; Layout leaves this event to
	 * its listeners (HANDLED_ERROR_EVENTS), so it is said once.
	 */
	function handleLorebooksImportError(msg: Sockets.ErrorResponse) {
		if (!importPending) return
		importPending = false
		toaster.error({ title: msg.error || "Failed to import lorebook" })
	}

	function handleLorebooksImportResolve(
		msg: Sockets.Lorebooks.ImportResolve.Response
	) {
		if (!importPending) return
		importPending = false
		const toast = lorebookImportedToast(msg.warnings)
		toaster[toast.kind]({ title: toast.title, description: toast.description })
		if (msg.lorebook) onImported?.(msg.lorebook.id)
	}

	function handleLorebooksImportResolveError(msg: Sockets.ErrorResponse) {
		if (!importPending) return
		importPending = false
		toaster.error({
			title: msg.error || "Failed to resolve lorebook import"
		})
	}

	function handleLorebooksDelete(msg: Sockets.Lorebooks.Delete.Response) {
		// This tab's own delete only; every tab's list refreshes on its own.
		if (pendingDeleteId === null) return
		if (msg.id !== undefined && msg.id !== pendingDeleteId) return
		const id = pendingDeleteId
		pendingDeleteId = null
		toaster.success({ title: "Lorebook deleted" })
		onDeleted?.(id)
	}

	/** The refusal is toasted by Layout's catch-all; stop waiting on it. */
	function handleLorebooksDeleteError() {
		pendingDeleteId = null
	}

	/**
	 * Every key here is BARE. These are the book-level actions — make, bring
	 * in, copy, remove — and not one of their replies names a book in
	 * `SCOPED_EVENTS`, so a scoped key would match nothing at all. The bar is
	 * the same for the `:error` events beside them: never gated (plan ruling
	 * 2 — an error is not an output to skip), but the registry is the only
	 * listener path.
	 */
	useInterest<"lorebooks:create">("lorebooks:create", handleLorebooksCreate)
	useInterest<"lorebooks:import">("lorebooks:import", handleLorebooksImport)
	useInterest<"lorebooks:import:error">(
		"lorebooks:import:error",
		handleLorebooksImportError
	)
	useInterest<"lorebooks:importResolve">(
		"lorebooks:importResolve",
		handleLorebooksImportResolve
	)
	useInterest<"lorebooks:importResolve:error">(
		"lorebooks:importResolve:error",
		handleLorebooksImportResolveError
	)
	useInterest<"lorebooks:delete">("lorebooks:delete", handleLorebooksDelete)
	useInterest<"lorebooks:delete:error">(
		"lorebooks:delete:error",
		handleLorebooksDeleteError
	)
	useInterest<"lorebooks:duplicate">(
		"lorebooks:duplicate",
		handleLorebooksDuplicate
	)
	useInterest<"lorebooks:duplicate:error">(
		"lorebooks:duplicate:error",
		handleLorebooksDuplicateError
	)
</script>

<NewLorebookDialog
	bind:open={creating}
	onOpenChange={(details) => (creating = details.open)}
	onConfirm={handleCreateConfirm}
	onCancel={() => (creating = false)}
	onImportInstead={() => {
		creating = false
		importing = true
	}}
	{canOfferAttachToSession}
	sessionName={openSessionCtx.sessionName}
/>

{#if importConflict}
	<ImportConflictModal
		open={showImportConflictModal}
		onOpenChange={(e) => {
			showImportConflictModal = e.open
			if (!e.open) importConflict = undefined
		}}
		entityLabel="Lorebook"
		existingName={importConflict.existingLorebook.name}
		losses={describeOverwriteLosses(importConflict.losses)}
		onOverwrite={handleOverwriteImportConflict}
		onImportAsNew={handleImportAsNewFromConflict}
		onCancel={() => {
			showImportConflictModal = false
			importConflict = undefined
		}}
	/>
{/if}

{#if importing}
	<Dialog
		open={importing}
		onOpenChange={(e) => {
			importing = e.open
			if (!e.open) importingBook = undefined
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
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import lorebook</h2>
						{#if !importingBook}
							<label class="mb-2" for="file-upload">
								Select a file.
							</label>
							<FileDropzone
								name="file-upload"
								accept=".json"
								onFileAccept={handleFileImport}
							/>
						{:else}
							<label class="mb-2" for="name">Name</label>
							<input
								id="name"
								type="text"
								bind:value={importingBook.name}
								placeholder="Lorebook name"
								class="input"
							/>
						{/if}
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => {
									importing = false
									importingBook = undefined
								}}
							>
								Cancel
							</button>
							{#if importingBook}
								<button
									class="btn preset-filled-primary-500"
									disabled={!importingBook?.name?.trim()}
									onclick={handleImportConfirm}
								>
									Import
								</button>
							{/if}
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if duplicating}
	<Dialog
		open={duplicating !== null}
		onOpenChange={(e) => {
			if (!e.open) duplicating = null
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
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">
							Duplicate lorebook
						</h2>
						<p class="text-surface-700-300 mb-4 text-sm">
							An exact copy: every entry on every branch, the
							cast and their dated changes, the links, the
							scenes, the tags and the story's calendar. Nothing
							is read into a session until you say so.
						</p>
						<label class="mb-2 block" for="duplicate-name">
							Name
						</label>
						<input
							id="duplicate-name"
							type="text"
							class="input"
							bind:value={duplicateName}
							placeholder={copyName(duplicating.name)}
							disabled={duplicatePending}
						/>
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								type="button"
								onclick={() => (duplicating = null)}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-primary-500"
								type="button"
								disabled={duplicatePending}
								onclick={handleDuplicateConfirm}
							>
								{duplicatePending ? "Copying…" : "Duplicate"}
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if deletingId !== null}
	<Dialog
		open={deletingId !== null}
		onOpenChange={(e) => {
			if (!e.open) deletingId = null
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
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="text-error-500 mb-2 text-lg font-bold">
							Delete lorebook?
						</h2>
						<p class="mb-4">
							Are you sure you want to delete this lorebook? This
							action cannot be undone.
						</p>
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => (deletingId = null)}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-error-500"
								onclick={handleDeleteConfirm}
							>
								Delete
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
