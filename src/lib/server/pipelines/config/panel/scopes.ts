/**
 * Who may write what, and where their write lands.
 *
 * Three questions, kept apart because they have different answers: which target
 * does this viewer write at (`writeScopeFor`), may this viewer see this slot at
 * all (`visibleTo`), and — given an option they are allowed to write — where
 * does the write actually go (`resolveWriteScope`).
 *
 * The layer model behind all three (ruled 2026-08-24): a pipeline has author
 * defaults, a selected **config**, and a session's **overrides** — nothing else.
 * The former instance and user override scopes are gone; an admin's site-wide
 * edit is an edit to the config itself, and a person's levers are the session's.
 */

import { WRITE_MATRIX, mayWrite, type ScopeKind } from "@serene-pub/sdk"
import {
	OptionNotWritableError,
	type Viewer,
	type WriteScope
} from "$lib/server/pipelines/config/panel/types"

/**
 * Which target this viewer's edits land at.
 *
 * A fact, not a question. 05 §0a: configuring from inside a session writes at
 * session scope; everywhere else, an edit is to the configuration itself. The
 * panel shows this rather than offering a picker, because a picker asks the
 * user to understand the resolution chain before they can change a prompt.
 */
export const writeScopeFor = (viewer: Viewer): WriteScope =>
	viewer.sessionId != null ? "session" : "config"

/**
 * Is this slot any of this person's business?
 *
 * Absent, not disabled — a greyed control invites the question it cannot
 * answer. The 0.6 line (user-ratified, DECOMPOSITION §26): a non-admin sees
 * **prompts and nothing else**. To them the pipeline is how the application
 * works, not a thing they operate — weights, sampling, review gates and
 * connections are the instance's configuration. Prompts stay visible because
 * wording is the one thing that is genuinely theirs to change *for a session*;
 * outside a session their panel is a reading surface.
 *
 * Narrower than the SDK write matrix on purpose. The matrix says what a scope
 * *may* store; this says what this application offers, and `resolveWriteScope`
 * enforces the same line so a minted id cannot reach what the panel does not
 * show.
 */
export const visibleTo = (matrixSlot: string, viewer: Viewer): boolean =>
	viewer.isAdmin || matrixSlot === "prompts"

/**
 * Decide where a write lands, and refuse in a sentence if it may not.
 *
 * Both refusals name the reason rather than the rule: the reader is someone who
 * used a control that was offered to them, and "scope 'user' may not write slot
 * 'connection'" tells them nothing they can act on (15 §1.3).
 *
 * The matrix is consulted at `session` for session writes and at `instance` for
 * config writes — a config's values are what the whole instance resolves, so
 * the instance column is the one that states what may live there (F20's
 * connection rule included).
 */
export function resolveWriteScope(
	viewer: Viewer,
	requested: WriteScope | undefined,
	matrixSlot: string
): { scope: WriteScope; scopeId: number } {
	const scope: WriteScope = requested ?? writeScopeFor(viewer)

	if (scope === "config" && !viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator edits a configuration, because everyone " +
				"resolving it gets the change. Nothing was saved — open the " +
				"session you want to change and edit there, or ask an administrator."
		)

	// The 0.6 line, enforced where writes arrive and not only where the panel
	// renders (`visibleTo`): a non-admin changes prompts and nothing else.
	// The ids are HMAC handles rather than secrets a viewer was granted, so
	// hiding an option is not what protects it — this refusal is.
	if (!viewer.isAdmin && matrixSlot !== "prompts")
		throw new OptionNotWritableError(
			"That setting is part of how this application is configured, so it " +
				"stays with the administrator. Prompts are yours to change in " +
				"your sessions."
		)

	const matrixScope: ScopeKind = scope === "config" ? "instance" : "session"
	if (!mayWrite(matrixSlot, matrixScope)) {
		const allowed = WRITE_MATRIX[matrixSlot] ?? []
		throw new OptionNotWritableError(
			matrixSlot === "connection"
				? "Connections stay with the administrator, so credentials and " +
					"compute stay under their control."
				: "That setting is not yours to change here. It is set " +
					(allowed.length
						? `at ${allowed.join(" or ")} level`
						: "elsewhere") +
					" by an administrator."
		)
	}

	return {
		scope,
		scopeId: scope === "session" ? viewer.sessionId! : 0
	}
}
