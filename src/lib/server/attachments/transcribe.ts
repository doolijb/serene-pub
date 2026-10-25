/**
 * 🚧 **Hearing audio for a run** — the host half of
 * `core:oracle/transcribe-audio@1` (O9, 2026-10-21).
 *
 * The binding decided which files need hearing (`transcription.ts`); this
 * resolves the model that hears — the step's own slot, else the Transcription
 * loadout's default (`audio->text`) — reads each file under the run's access
 * rule (`resolveAttachments`: this session's or this user's, never anyone
 * else's), sends it through the type's transcription adapter, and CACHES the
 * words on the file (`files.transcript`), so a voice note is heard once
 * whichever reply needs it.
 *
 * Never a refusal of the reply: with no model set up to hear, a connection
 * type that cannot, or a file that fails, the files pass through untouched and
 * the notes say so on the receipt — an explicit step, never silent.
 *
 * Takes `db` explicitly (the run's own handle).
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { transcriptionNotes } from "./transcription"

/** The capability the hearing model needs. */
export const HEARING_CAPABILITY = "audio->text"

export interface TranscribeFilesInput {
	files: ReadonlyArray<{ uuid: string; mime?: string; filename?: string }>
	/** The step's own pick, when it named one; else the loadout default. */
	connectionId?: number | null
	connectionModelId?: number | null
	language?: string
	sessionId?: number
	userId?: number
	signal?: AbortSignal
}

export interface TranscribeFilesResult {
	/** The words, by file uuid — only the files that were heard. */
	transcripts: Record<string, string>
	notes: string[]
}

export async function transcribeFiles(
	db: Db,
	input: TranscribeFilesInput
): Promise<TranscribeFilesResult> {
	const files = input.files.filter((f) => typeof f?.uuid === "string" && f.uuid)
	if (!files.length) return { transcripts: {}, notes: [] }
	const unheard = (why: string): TranscribeFilesResult => ({
		transcripts: {},
		notes: transcriptionNotes({ heard: 0, failed: 0, unheard: files.length, why })
	})

	const { resolveCapabilityTarget } = await import(
		"$lib/server/connections/capabilityTarget"
	)
	const target = await resolveCapabilityTarget(db, {
		capability: HEARING_CAPABILITY as never,
		pipelineConfig:
			input.connectionId != null
				? {
						connectionId: input.connectionId,
						connectionModelId: input.connectionModelId ?? null
					}
				: null
	})
	// The resolver's sentence names no connection (`capabilityRefusal`).
	if (!target.ok)
		return unheard(
			`no model is set up to hear audio — ${target.problem.message} Fill the Transcription loadout to hear voice notes.`
		)

	const { getTranscriptionAdapter } = await import(
		"$lib/server/utils/getTranscriptionAdapter"
	)
	const mod = await getTranscriptionAdapter(target.connection.type)
	if (!mod)
		return unheard(
			"the Transcription loadout's connection type cannot transcribe audio."
		)
	const adapter = new mod.Adapter(target.connection as AdapterConnection)

	const { resolveAttachments } = await import(
		"$lib/server/pipelines/runtime/dispatch"
	)
	const transcripts: Record<string, string> = {}
	let failed = 0
	for (const file of files) {
		if (input.signal?.aborted) break
		let bytes: { bytes: Buffer | Uint8Array; mime: string; filename?: string }
		try {
			const [loaded] = await resolveAttachments(db, [file.uuid], {
				sessionId: input.sessionId,
				userId: input.userId
			})
			if (!loaded) {
				failed++
				continue
			}
			bytes = loaded
		} catch {
			failed++
			continue
		}
		try {
			const heard = await adapter.transcribeAudio(
				{
					audio: {
						bytes: bytes.bytes,
						mime: bytes.mime,
						...(bytes.filename ?? file.filename
							? { filename: bytes.filename ?? file.filename }
							: {})
					},
					...(input.language ? { language: input.language } : {})
				},
				{ signal: input.signal }
			)
			if (heard.isAborted) break
			const words = heard.text.trim()
			if (!words) {
				failed++
				continue
			}
			transcripts[file.uuid] = words
			// Cached on the FILE: the same voice note in another reply, or the
			// next turn's, is heard from here and never sent again.
			await db
				.update(schema.files)
				.set({ transcript: words })
				.where(eq(schema.files.uuid, file.uuid))
		} catch {
			failed++
		}
	}
	return {
		transcripts,
		notes: transcriptionNotes({
			heard: Object.keys(transcripts).length,
			failed,
			unheard: 0
		})
	}
}
