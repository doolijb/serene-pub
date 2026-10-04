/**
 * The `download-settled` producer (PLAN-notifications §5): a model download
 * that finished or failed raises a row for the admin who STARTED it — nobody
 * else pressed the button, so nobody else is waiting on it.
 *
 * Called from each download's settle point: `sockets/koboldcpp.ts` (the
 * detached download task), `sockets/localOnnxModels.ts` (`runWarm`) and
 * `sockets/ollama.ts` (the pull handler). A cancel raises nothing — the person
 * who cancelled already knows.
 *
 * Done and failed share one `regarding` (`regardingFor.download`), so a retry
 * that succeeds bumps the open failed row into a done one rather than leaving
 * both.
 *
 * Never throws (the store's rule).
 */
import {
	DOWNLOAD_DONE,
	DOWNLOAD_FAILED,
	regardingFor
} from "$lib/shared/notifications/kinds"
import { LOGBOOK_OBJECT_TYPES } from "$lib/shared/adminLogbook"
import { raiseNotification } from "./store"
import { messageWithoutQueryText } from "$lib/server/db/errors"

export type DownloadSource = "koboldcpp" | "onnx" | "ollama"

/** Longest `error` a row carries. */
export const DOWNLOAD_ERROR_MAX = 160

/** The admin address of a connection, or the Connections index without one. */
export function downloadHref(connectionId: number | null | undefined): string {
	return LOGBOOK_OBJECT_TYPES.connection.href(
		connectionId == null ? null : String(connectionId)
	)
}

/**
 * A failure as a row may show it: one line, credentials in any URL masked
 * (`scheme://user:pass@host` → `scheme://…@host`), and at most
 * `DOWNLOAD_ERROR_MAX` characters.
 */
export function shortDownloadError(err: unknown): string {
	// A failed query is the plain sentence, before the whitespace is collapsed
	// (which would hide drizzle's `params:` line from every later check).
	const raw =
		err instanceof Error || typeof err === "string"
			? messageWithoutQueryText(err)
			: "Unknown error"
	const line = (raw || "Unknown error")
		.replace(/\s+/g, " ")
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1…@")
		.trim()
	return line.length > DOWNLOAD_ERROR_MAX
		? `${line.slice(0, DOWNLOAD_ERROR_MAX - 1)}…`
		: line
}

export interface DownloadSettled {
	/** The admin who started the download. Absent/null: raise nothing. */
	userId: number | null | undefined
	source: DownloadSource
	/** Names the model within its source — a file name, a model id. */
	key: string
	/** What the row calls the model. */
	model: string
	href: string
	/** Absent when it finished; the failure when it did not. */
	error?: unknown
}

export async function notifyDownloadSettled(
	input: DownloadSettled,
	db?: Db
): Promise<void> {
	if (input.userId == null) return
	const failed = input.error !== undefined
	await raiseNotification(
		{
			userIds: [input.userId],
			kind: failed ? DOWNLOAD_FAILED.id : DOWNLOAD_DONE.id,
			regarding: regardingFor.download(input.source, input.key),
			href: input.href,
			vars: failed
				? { model: input.model, error: shortDownloadError(input.error) }
				: { model: input.model }
		},
		db
	)
}
