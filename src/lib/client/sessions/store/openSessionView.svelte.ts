/**
 * 🚧 The open session as the shell reads it (Layout's `openSessionCtx`): every session fact
 * a getter over the session store; the three things the page judges (its header's cast with
 * the next speaker, its header notice, its header presses) written by the page.
 * Call during a component's init (its deriveds are that component's).
 */
import { branchOfLabel, branchOfSession } from "$lib/shared/sessions/branchOf"
import { generatingOf, lorebookFixedOf, storyClockKeyOf } from "./derive"
import type { SessionStore } from "./sessionStore.svelte"

export function createOpenSessionView(d: { store: SessionStore; userId(): number | null }): OpenSessionCtx {
	const id = $derived(d.store.openSessionId)
	const record = $derived(id !== null ? d.store.session(id) : undefined)
	const rows = $derived(id !== null && record ? d.store.messagesOf(id) : [])
	const runs = $derived(id !== null && record ? d.store.runsOf(id) : [])
	const clockKey: string = $derived(storyClockKeyOf(record))
	/** A new object only when the clock moves. */
	const storyClock = $derived(clockKey ? (JSON.parse(clockKey) as OpenSessionCtx["storyClock"]) : null)
	const branchLabel: string | null = $derived(branchOfLabel(branchOfSession(record as any)))
	const genreName: string | null = $derived(id !== null ? (d.store.genreOf(id)?.name ?? null) : null)
	const lorebookFixed: boolean = $derived(lorebookFixedOf(record, rows))
	const isGenerating: boolean = $derived(record ? generatingOf(rows, runs) : false)

	let cast = $state.raw<OpenSessionCastMember[]>([])
	let headerNotice = $state.raw<SessionHeaderNotice | null>(null)
	let rewind = $state.raw<SessionHeaderRewind | null>(null)

	return {
		get sessionId() {
			return record ? id : null
		},
		get sessionName() {
			return record?.name ?? null
		},
		get genreName() {
			return genreName
		},
		get branchOfLabel() {
			return branchLabel
		},
		get archived() {
			return !!(record as { archivedAt?: unknown } | undefined)?.archivedAt
		},
		get lorebookId() {
			return record?.lorebookId ?? null
		},
		get lorebookBranchId() {
			return record?.lorebookBranchId ?? null
		},
		get lorebookFixed() {
			return lorebookFixed
		},
		get storyClock() {
			return storyClock
		},
		get isOwner() {
			return record != null && record.userId === d.userId()
		},
		get isGenerating() {
			return isGenerating
		},
		get cast() {
			return cast
		},
		set cast(v) {
			cast = v
		},
		get headerNotice() {
			return headerNotice
		},
		set headerNotice(v) {
			headerNotice = v
		},
		get rewind() {
			return rewind
		},
		set rewind(v) {
			rewind = v
		}
	}
}
