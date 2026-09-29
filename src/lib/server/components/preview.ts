/**
 * **Component previews** (C6, P4): the editor's compiled-but-unsaved module,
 * served at a capability URL, `/component-preview/<token>`.
 *
 * A preview is the artifact of source nobody saved — so it has no row, no
 * cache file and no owner id, and it must reach exactly one viewer: the
 * admin whose `components:preview` compiled it. Three rules make that so:
 *
 * - **The token is the capability.** 128 random bits, hex; unguessable, never
 *   listed, never logged.
 * - **Bound to its minter.** The route answers only a request whose session
 *   cookie authenticates as the user who minted it (`authenticateRequest`);
 *   anyone else — another user, no session, a token that expired — gets the
 *   same 404 a token that never existed gets, so the route says nothing about
 *   which tokens are live.
 * - **Short-lived and bounded.** {@link PREVIEW_TTL_MS} (10 minutes) from
 *   minting; at most {@link PREVIEW_PER_USER} live per user (the oldest goes)
 *   — a module is up to 3 MiB, and this store is memory.
 *
 * In memory on purpose: a restart forgets every preview, which costs an
 * editor one recompile and keeps unsaved code off the disk.
 */
import { randomBytes } from "node:crypto"

/** How long a preview URL answers after it is minted. */
export const PREVIEW_TTL_MS = 10 * 60 * 1000
/** Live previews one user may hold; minting another drops their oldest. */
export const PREVIEW_PER_USER = 8

const TOKEN = /^[a-f0-9]{32}$/

interface Preview {
	userId: number
	code: string
	expiresAt: number
}

const previews = new Map<string, Preview>()

let clock: () => number = () => Date.now()

/** The URL a preview token is served at. */
export const componentPreviewUrl = (token: string): string => `/component-preview/${token}`

function sweep(now: number): void {
	for (const [token, p] of previews) if (p.expiresAt <= now) previews.delete(token)
}

/** Hold `code` for `userId` and answer the capability URL that serves it. */
export function mintComponentPreview(
	userId: number,
	code: string
): { token: string; url: string; expiresAt: string } {
	const now = clock()
	sweep(now)
	const mine = [...previews].filter(([, p]) => p.userId === userId).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
	while (mine.length >= PREVIEW_PER_USER) previews.delete(mine.shift()![0])
	const token = randomBytes(16).toString("hex")
	const expiresAt = now + PREVIEW_TTL_MS
	previews.set(token, { userId, code, expiresAt })
	return { token, url: componentPreviewUrl(token), expiresAt: new Date(expiresAt).toISOString() }
}

/**
 * The preview's module — only for the user who minted it, only while live.
 * `null` for every other case, alike: the caller answers each with one 404.
 */
export function readComponentPreview(token: string | undefined, userId: number | null | undefined): string | null {
	if (!token || !TOKEN.test(token) || userId == null) return null
	const p = previews.get(token)
	if (!p) return null
	if (p.expiresAt <= clock()) {
		previews.delete(token)
		return null
	}
	return p.userId === userId ? p.code : null
}

/** @internal Tests only: a controllable clock (`undefined` restores `Date.now`), and an empty store. */
export function __setPreviewClockForTests(next: (() => number) | undefined): void {
	clock = next ?? (() => Date.now())
}
export function __clearComponentPreviewsForTests(): void {
	previews.clear()
}
