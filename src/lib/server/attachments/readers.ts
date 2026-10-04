/**
 * **Attachment readers** — what the model calls of a session's reply can
 * read (PLAN-composer-attachments §3.2; owner D1/D3, 2026-10-02).
 *
 * One function, three readers of its answer: the composer (the readers line
 * and the kinds it disables), the server's tray and Send checks
 * (`attachments:begin`, `commitTraySend`), and each model call at prompt
 * time — `pairReads` is what `config/world.ts` puts on a connection
 * descriptor as `metadata.reads`, which `core:task/place-attachments@1` reads.
 *
 * The walk:
 *
 *  1. **The specs that read the transcript** — the reply (the session's
 *     genre's `message:respond` subject, resolved the way a turn resolves it,
 *     `resolveSubjectSpec`), then the form answer (`form-addressed`) and each
 *     action the session has switched on (attachments follow-ups, owner
 *     ruling 2026-10-03: Look, Ask, Build room, Whisper…). A non-reply call is
 *     keyed `<spec slug>#<node key>` and headed with its action's name.
 *  2. **Its reading calls** — the model calls a placement step writes for:
 *     each `core:task/place-attachments@1` node's `connection` slot names
 *     the step that sends its prompt (`slot.connectionOf('<call>')`), and
 *     that step is a reading call. The placement judges on exactly that
 *     call's pair, so this list and the prompt cannot disagree. A spec with
 *     no placement node has no reading calls — old and plugin specs degrade
 *     honestly to "nothing here reads images". A planner fed a prose
 *     transcript with no placement is not one.
 *  3. **Each call's pair** — its `connection` slot as the session's world
 *     resolves it, through `resolveCapabilityTarget`, so the pair is the one
 *     the run would be sent to (a call that runs on another call's model —
 *     `slot.connection(node)` — is judged on that call's pair).
 *  4. **Per kind**:
 *     - **image** — the pair can do `text+image->text` (`capabilityRefusal`),
 *       its type sends files on its wire mode (`sendsAttachmentsOn`), and the
 *       wire mode is one that carries them;
 *     - **pdf** — the same with `text+document->text`, and the type's `io`
 *       accepts `application/pdf`;
 *     - **text** — always: a text file is inlined as text, which every model
 *       reads.
 *  5. **The union** (D1): a kind may be attached when at least one reading
 *     call reads it; each call that cannot gets a placeholder (D3). When none
 *     can, the kind is refused with the first call's reason.
 *
 * **Visibility.** Every `reason` is a sentence that names no connection
 * (`capabilityRefusal`'s, the resolver's). A call's pair rides as
 * `connection` (`connectionIdentity`), which `redactConnections` removes at
 * the socket for everyone who is not an administrator — the existing
 * projection, not a second redaction.
 *
 * Takes `db` explicitly (the default-db dynamic import bypasses a test's
 * `vi.mock`), and is called OUTSIDE any transaction: it reads pipeline
 * bindings and connections, which are not a send's to lock.
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	ATTACHMENT_CAPS,
	ATTACHMENT_KINDS,
	attachmentCapBytes,
	type AttachmentKind
} from "$lib/shared/attachments/caps"
import type { ConnectionIdentity } from "$lib/shared/connections/identity"
import type {
	AttachmentReaders,
	AttachmentReadingCall,
	AttachmentVerdict
} from "$lib/shared/sockets/attachments"

export type {
	AttachmentReaders,
	AttachmentReadingCall,
	AttachmentVerdict
} from "$lib/shared/sockets/attachments"

/** The placement step; the call its `connection` slot names is a reading call. */
export const PLACEMENT_DEFINITION = "core:task/place-attachments"

/** The transform each media kind needs. Text needs none. */
const KIND_TRANSFORM = {
	image: "text+image->text",
	pdf: "text+document->text"
} as const

/** What the picker offers for a kind it may attach. */
const KIND_ACCEPTS: Record<AttachmentKind, string[]> = {
	image: ["image/png", "image/jpeg", "image/webp", "image/gif", ".png", ".jpg", ".jpeg", ".webp", ".gif"],
	text: ["text/plain", "text/markdown", ".txt", ".md", ".markdown"],
	pdf: ["application/pdf", ".pdf"]
}

const KIND_PLURAL: Record<AttachmentKind, string> = {
	image: "images",
	text: "text files",
	pdf: "PDFs"
}

export const NO_READING_CALLS = (kind: AttachmentKind): string =>
	`Nothing in this session's reply reads ${KIND_PLURAL[kind]}, so they can't be attached here.`

export const KIND_NOT_READ = (kind: AttachmentKind, why?: string): string =>
	`No model in this reply can read ${KIND_PLURAL[kind]}.${why ? ` ${why}` : ""}`

export const NOT_SENT_BY_TYPE = (kind: AttachmentKind): string =>
	`This connection type doesn't send ${KIND_PLURAL[kind]} to its model yet.`

export const COMPLETION_WIRE = (kind: AttachmentKind): string =>
	`This connection sends its prompt as completion text, which carries no ${KIND_PLURAL[kind]}. Switch it to chat to send them.`

export const PDF_NOT_ACCEPTED =
	"This connection type doesn't take PDFs."

/** The answer with nothing to ask: no session, no genre, no reply spec. */
function answer(calls: AttachmentReadingCall[]): AttachmentReaders {
	const kinds = {} as Record<AttachmentKind, AttachmentVerdict>
	const accepts = {} as Record<AttachmentKind, string[]>
	for (const kind of ATTACHMENT_KINDS) {
		if (kind === "text") {
			kinds.text = { allowed: true }
		} else if (calls.some((c) => c.reads.includes(kind))) {
			kinds[kind] = { allowed: true }
		} else {
			const why = calls.find((c) => c.reasons[kind])?.reasons[kind]
			kinds[kind] = {
				allowed: false,
				reason: calls.length ? KIND_NOT_READ(kind, why) : NO_READING_CALLS(kind)
			}
		}
		accepts[kind] = kinds[kind].allowed ? [...KIND_ACCEPTS[kind]] : []
	}
	return {
		kinds,
		calls,
		accepts,
		limits: {
			filesPerMessage: ATTACHMENT_CAPS.filesPerMessage,
			bytesPerKind: Object.fromEntries(
				ATTACHMENT_KINDS.map((k) => [k, attachmentCapBytes(k)])
			) as Record<AttachmentKind, number>
		}
	}
}

interface SlotRefLike {
	__ref: "slot"
	slot?: string
	ofNode?: string
}
const isSlotRef = (v: unknown): v is SlotRefLike =>
	!!v && typeof v === "object" && (v as { __ref?: unknown }).__ref === "slot"

/**
 * One pair's verdict per media kind — `null` where it reads the kind, else
 * the sentence. Pure over the resolved pair, so it is the one predicate (§5.2:
 * the slot descriptor's `metadata.reads` is computed by it in `world.ts`).
 */
export async function pairReads(connection: {
	name?: string | null
	type: string
	capabilities?: unknown
	connectionModelModality?: string | null
	wireMode?: string | null
}): Promise<Record<"image" | "pdf", string | null>> {
	const { capabilityRefusal } = await import(
		"$lib/server/pipelines/runtime/capabilityGuard"
	)
	const { sendsAttachmentsOn, adapterIo } = await import(
		"$lib/shared/connectionAdapters/manifest"
	)
	const wire = connection.wireMode === "completion" ? "completion" : "chat"
	const judge = (kind: "image" | "pdf"): string | null => {
		const refused = capabilityRefusal(connection, KIND_TRANSFORM[kind] as any)
		if (refused) return refused
		if (!sendsAttachmentsOn(connection.type, wire))
			return wire === "completion" && sendsAttachmentsOn(connection.type, "chat")
				? COMPLETION_WIRE(kind)
				: NOT_SENT_BY_TYPE(kind)
		if (kind === "pdf") {
			const accepts = adapterIo(connection.type)?.in?.document?.accepts ?? []
			if (!accepts.some((m) => String(m) === "application/pdf"))
				return PDF_NOT_ACCEPTED
		}
		return null
	}
	return { image: judge("image"), pdf: judge("pdf") }
}

/** What the form answer's calls are headed with in the dialog (no action names it). */
export const FORM_ANSWER_LABEL = "Form answers"

/**
 * The specs whose model calls read this session's transcript, reply first
 * (attachments follow-ups, owner ruling 2026-10-03): the reply, the form
 * answer, and each action the session has switched on — Look, Ask, Build room,
 * Whisper… A spec with no placement step contributes no reading call, so the
 * list is exactly the specs that place files. `title` heads a non-reply
 * spec's calls; the reply's keep their own headings.
 */
async function transcriptReaders(
	db: Db,
	input: { sessionId: number; userId: number; genreId: string }
): Promise<Array<{ slug: string; title?: string }>> {
	const { resolveSubjectSpec, enabledSessionFunctions } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const { resolveSessionEventSpec } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const { sessionEvents } = await import("@serene-pub/sdk")
	const out: Array<{ slug: string; title?: string }> = []
	const seen = new Set<string>()
	const add = (slug: string | null | undefined, title?: string) => {
		if (!slug || seen.has(slug)) return
		seen.add(slug)
		out.push({ slug, ...(title ? { title } : {}) })
	}
	// 1. The reply spec, as a turn resolves it.
	add(
		await resolveSubjectSpec(db, input.genreId, sessionEvents.messageRespond, {
			sessionId: input.sessionId
		})
	)
	// 2. The form answer, as `runTurn` resolves it when a form is put to the AI.
	add(
		await resolveSessionEventSpec(
			db,
			input.genreId,
			sessionEvents.formAddressed,
			{ sessionId: input.sessionId }
		).catch(() => null),
		FORM_ANSWER_LABEL
	)
	// 3. Each action the session has on, by its spec — named for the action.
	const actions = await enabledSessionFunctions(
		db,
		input.sessionId,
		input.genreId,
		input.userId
	).catch(() => [])
	for (const action of actions) add(action.specSlug, action.name)
	return out
}

export async function attachmentReaders(
	db: Db,
	input: { sessionId: number; userId: number; channel?: string }
): Promise<AttachmentReaders> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session?.genreId) return answer([])
	const specs = await transcriptReaders(db, {
		sessionId: input.sessionId,
		userId: input.userId,
		genreId: session.genreId
	})
	const calls: AttachmentReadingCall[] = []
	for (const spec of specs)
		calls.push(
			...(await readingCallsOf(db, {
				sessionId: input.sessionId,
				genreId: session.genreId,
				...spec
			}))
		)
	return answer(calls)
}

/**
 * One spec's reading calls, judged on the pairs the session's world resolves.
 * The reply spec's are keyed and headed as the panel heads them; another
 * spec's are keyed `<spec slug>#<node key>` (a `write` in Look and one in Ask
 * are two calls) and headed with `title` — alone when the spec has one
 * reading call, `title: heading` when it has several.
 */
async function readingCallsOf(
	db: Db,
	input: { sessionId: number; genreId: string; slug: string; title?: string }
): Promise<AttachmentReadingCall[]> {
	const { slug } = input
	const { resolveConfigSources } = await import("@serene-pub/sdk")
	const [spec] = await db
		.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	if (spec?.activeVersionId == null) return []

	// 2. Its reading calls: the oracle each placement step's `connection`
	//    slot names, in spine order.
	const graph = await db
		.select({
			nodeKey: schema.pipelineNodes.nodeKey,
			kind: schema.pipelineNodes.kind,
			definitionId: schema.pipelineNodes.definitionId,
			config: schema.pipelineNodes.config,
			resolvedRefs: schema.pipelineNodes.resolvedRefs,
			expose: schema.pipelineNodes.expose,
			position: schema.pipelineNodes.position
		})
		.from(schema.pipelineNodes)
		.where(
			and(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId),
				inArray(schema.pipelineNodes.kind, ["oracle", "task"])
			)
		)
	const readKeys = new Set<string>()
	for (const placement of graph) {
		if (placement.definitionId !== PLACEMENT_DEFINITION) continue
		const ref = (placement.config as Record<string, unknown> | undefined)
			?.connection
		if (!isSlotRef(ref)) continue
		readKeys.add(
			placement.resolvedRefs?.connection ?? ref.ofNode ?? placement.nodeKey
		)
	}
	const nodes = graph.filter(
		(n) => n.kind === "oracle" && readKeys.has(n.nodeKey)
	)
	if (!nodes.length) return []
	nodes.sort((a, b) => a.position - b.position)

	// 3. Each call's pair, as the session's world resolves its slot. A call
	//    that runs on another call's model is judged on that call's slot.
	// The executor's own reading (`resolveSlot`): the reference's resolved
	// target, else its `ofNode`, else the node itself.
	const ownerOf = (key: string): string => {
		const at = nodes.find((n) => n.nodeKey === key)
		const ref = (at?.config as Record<string, unknown> | undefined)?.connection
		if (!isSlotRef(ref)) return key
		return at?.resolvedRefs?.connection ?? ref.ofNode ?? key
	}
	const slotKeys = [...new Set(nodes.map((n) => ownerOf(n.nodeKey)))]
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, {
		sessionId: input.sessionId,
		specId: slug
	})
	const sourced: any = resolveConfigSources(world as any, slotKeys)
	const { slotConnectionId, slotModelId } = await import(
		"$lib/shared/connections/slotRef"
	)
	const { resolveCapabilityTarget, TEXT_CAPABILITY } = await import(
		"$lib/server/connections/capabilityTarget"
	)
	const { connectionIdentity } = await import(
		"$lib/server/connections/visibility"
	)
	const { groupHeadingOf } = await import(
		"$lib/server/pipelines/config/panel/groups"
	)
	const { humanizeTypeId } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)

	const calls: AttachmentReadingCall[] = []
	for (const node of nodes) {
		const owner = ownerOf(node.nodeKey)
		const slot = sourced?.[owner]?.connection?.[""]?.value
		const connectionId = slotConnectionId(slot)
		const target = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			pipelineConfig:
				connectionId != null
					? { connectionId, connectionModelId: slotModelId(slot) }
					: null,
			genreId: input.genreId
		})
		const heading = groupHeadingOf(
			{ expose: node.expose as any },
			humanizeTypeId(node.definitionId)
		)
		const label = !input.title
			? heading
			: nodes.length === 1
				? input.title
				: `${input.title}: ${heading}`
		const reads: AttachmentKind[] = ["text"]
		const placeholderFor: AttachmentKind[] = []
		const reasons: Partial<Record<AttachmentKind, string>> = {}
		let connection: ConnectionIdentity | undefined
		if (!target.ok) {
			placeholderFor.push("image", "pdf")
			reasons.image = reasons.pdf = target.problem.message
			connection = target.problem.connection
		} else {
			connection = connectionIdentity(target.connection)
			const verdict = await pairReads(target.connection as any)
			for (const kind of ["image", "pdf"] as const) {
				if (verdict[kind] == null) reads.push(kind)
				else {
					placeholderFor.push(kind)
					reasons[kind] = verdict[kind]!
				}
			}
		}
		calls.push({
			key: input.title ? `${slug}#${node.nodeKey}` : node.nodeKey,
			label,
			reads: ATTACHMENT_KINDS.filter((k) => reads.includes(k)),
			placeholderFor,
			reasons,
			...(connection ? { connection } : {})
		})
	}
	return calls
}
