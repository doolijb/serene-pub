/**
 * The `open-form` producer (PLAN-notifications §5): a form put to a PERSON —
 * or to nobody, which the session owner answers (NOMENCLATURE §9 *addressee*,
 * W4) — raises a row for them; the row clears when the form stops needing
 * them.
 *
 * - **Raise** — `runSpec` (`runTurn.ts`), after the asking run's receipt is
 *   saved, for the forms the message writes collected on
 *   `HostScope.formsAwaitingPeople` (`host.ts` `writeBlocks`). A form put to
 *   the AI is never here: that is dispatched as `form-addressed`.
 * - **Acted** — `fireAction`, once `form-answered` is emitted and the block
 *   is marked answered.
 * - **Superseded** — `settleOpenForms`, called from `sessionEvents.ts` on
 *   `message-completed` / `message-updated` / `message-deleted`: staleness is
 *   COMPUTED (`isFormStale` over `stalenessHead`), never stored, so every open
 *   row of the session is re-checked against the row as it is now. Also the
 *   boot re-check (`recheckOpenForms`, registered in `service.ts`).
 *
 * Never throws.
 */
import { eq } from "drizzle-orm"
import { isFormStale } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { loadFormBlock } from "$lib/server/messages/blocks"
import { stalenessHead } from "$lib/server/messages/channels"
import {
	clearNotifications,
	openNotificationsOfKind,
	openNotificationsWithPrefix,
	raiseNotification
} from "./store"
import {
	OPEN_FORM,
	regardingFor,
	sessionHref,
	type NotificationRow
} from "$lib/shared/notifications/kinds"

/**
 * A form a run wrote that waits for a person's click. `userId` is the person
 * the run's pinned portrayals say portrays the addressee; null when the form
 * has no addressee or the addressee resolves to nobody — the owner's, then.
 */
export interface FormAwaitingPerson {
	messageId: number
	blockId: string
	userId: number | null
}

/** Where a form stands now, read off the stored row. */
export type FormStanding = "open" | "answered" | "stale" | "gone"

/** Throws on a failed read. */
export async function formStandingOf(
	db: Db,
	sessionId: number,
	messageId: number,
	blockId: string
): Promise<FormStanding> {
	const [row] = await db
		.select({
			sessionId: schema.sessionMessages.sessionId,
			channel: schema.sessionMessages.channel
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row || row.sessionId !== sessionId) return "gone"
	const block = await loadFormBlock(db, messageId, blockId)
	if (!block) return "gone"
	if (block.answered) return "answered"
	const headNow = await stalenessHead(db, sessionId, row.channel, messageId)
	return isFormStale(block, headNow) ? "stale" : "open"
}

/**
 * Raise a row for each form still open, for its person — or the session
 * owner when the form names nobody who is here.
 */
export async function raiseOpenForms(
	db: Db,
	sessionId: number,
	forms: ReadonlyArray<FormAwaitingPerson>
): Promise<void> {
	if (!forms.length) return
	try {
		const [session] = await db
			.select({ userId: schema.sessions.userId, name: schema.sessions.name })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session) return
		const sessionName = session.name?.trim() || "Untitled session"
		for (const form of forms) {
			// A later write in the same run may already have overtaken it.
			const standing = await formStandingOf(
				db,
				sessionId,
				form.messageId,
				form.blockId
			)
			if (standing !== "open") continue
			const userId =
				form.userId !== null && Number.isInteger(form.userId) && form.userId > 0
					? form.userId
					: session.userId
			await raiseNotification(
				{
					userIds: [userId],
					kind: OPEN_FORM.id,
					regarding: regardingFor.form(sessionId, form.messageId, form.blockId),
					href: sessionHref(sessionId, form.messageId, form.blockId),
					vars: { session: sessionName }
				},
				db
			)
		}
	} catch (err) {
		console.error(
			`[notifications] open-form raise for session ${sessionId} failed:`,
			err
		)
	}
}

/** Clear every user's row for one form as `acted` — it was answered. */
export async function clearAnsweredForm(
	db: Db,
	sessionId: number,
	messageId: number,
	blockId: string
): Promise<void> {
	await clearNotifications(
		{ regarding: regardingFor.form(sessionId, messageId, blockId) },
		"acted",
		db
	)
}

const FORM_KEY = /^session:(\d+)\/form:(\d+)\/(.+)$/

/**
 * Re-check open rows against their forms: answered → `acted`; overtaken or
 * gone (the message deleted, the block replaced, the session gone) →
 * `superseded`; still open → left alone.
 */
async function settleRows(db: Db, rows: NotificationRow[]): Promise<void> {
	for (const regarding of new Set(rows.map((r) => r.regarding))) {
		const m = FORM_KEY.exec(regarding)
		if (!m) continue
		const standing = await formStandingOf(db, Number(m[1]), Number(m[2]), m[3]!)
		if (standing === "open") continue
		await clearNotifications(
			{ regarding },
			standing === "answered" ? "acted" : "superseded",
			db
		)
	}
}

/**
 * A line landed, changed or went in a session: settle its open-form rows.
 * One read when the session has none.
 */
export async function settleOpenForms(db: Db, sessionId: number): Promise<void> {
	try {
		const rows = await openNotificationsWithPrefix(
			regardingFor.formsIn(sessionId),
			db
		)
		if (rows.length) await settleRows(db, rows)
	} catch (err) {
		console.error(
			`[notifications] open-form settle for session ${sessionId} failed:`,
			err
		)
	}
}

/** Boot: every open `open-form` row, re-checked. Raises nothing. */
export async function recheckOpenForms(db: Db): Promise<void> {
	await settleRows(db, await openNotificationsOfKind(OPEN_FORM.id, db))
}
