/**
 * Image generation through the KoboldCPP Manager.
 *
 * The render is A1111's, verbatim — `Adapter` below IS `A1111Adapter`, and
 * `/sdapi/v1/txt2img` is the same endpoint against the same process. What this
 * module exists for is the two questions asked AROUND a render, both of which
 * A1111's answers get wrong for a managed instance:
 *
 *   - **"Is this connection working?"** A1111 asks `/sdapi/v1/sd-models`. That
 *     endpoint 404s whenever koboldcpp is holding a text model — which, while
 *     only one model is resident at a time, is its normal resting state — so a
 *     correctly configured image connection reported "Reachable, but it has no
 *     image API." The honest question here is not "can it draw right now" but
 *     "is the Manager up, and does the model this row names exist", because
 *     loading it is deferred to render time on purpose.
 *   - **"Which models can I pick?"** A1111 lists the checkpoints the server
 *     already holds. The Manager holds none until asked; the list that matters
 *     is the image models on disk, which is `koboldcpp_models`.
 *
 * Both also have to resolve WHERE the process is from the Manager's settings
 * rather than from `connection.baseUrl` — a managed row's own URL is not
 * authoritative and is not kept in sync (see dispatchImage.resolveBaseUrl,
 * which documents the same trap for the render path).
 *
 * ## One model, and it is this row's
 *
 * A connection names exactly one model; this one names an image model. Whether
 * it is RESIDENT is a separate question with a separate owner — the model
 * manager decides what koboldcpp holds, and today's answer is "one thing at a
 * time". Nothing here asserts anything about that, which is why a test can pass
 * against a process currently holding an LLM.
 */
import a1111 from "./A1111Adapter"
import type { ImageAdapterExports } from "./BaseImageAdapter"
import type { SettingsSchema } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { pingKoboldCPP } from "$lib/server/koboldcpp/kcppHttp"
import { resolveModelPath } from "$lib/server/koboldcpp/modelsDir"

const DEFAULT_BASE_URL = "http://localhost:5001"

/**
 * The quantisation choices, as words rather than as the ints koboldcpp wants.
 *
 * `sdquant` is an int 0/1/2 on the wire, but `SchemaForm` renders an `enum` by
 * showing its `of` strings verbatim and stores back whatever was picked — so
 * declaring `of: ["0","1","2"]` would put three bare digits on screen and teach
 * nobody anything. The names are the form's vocabulary; `sdQuantToInt` below is
 * the single translation, and dispatchImage is its only caller.
 */
export const SD_QUANT_CHOICES = ["off", "q8", "q4"] as const

const SD_QUANT_INTS: Record<string, 0 | 1 | 2> = {
	off: 0,
	q8: 1,
	q4: 2,
	// The ints themselves, so a value set through any route other than the form
	// still means what it says.
	"0": 0,
	"1": 1,
	"2": 2
}

/**
 * What a stored `profile.sdQuant` means as koboldcpp's `sdquant` int.
 *
 * `undefined` for anything unrecognised, never a guessed 0: 0 is "don't
 * quantise", which is a real instruction, and silently substituting it for a
 * value we failed to read would hide the misconfiguration behind a working
 * render at the wrong precision.
 */
export function sdQuantToInt(value: unknown): 0 | 1 | 2 | undefined {
	if (value === undefined || value === null || value === "") return undefined
	return SD_QUANT_INTS[String(value)]
}

const PROFILE_SCHEMA: SettingsSchema = {
	...a1111.profileSchema,
	sdThreads: {
		type: "integer",
		label: "Image threads",
		description:
			"CPU threads for the image model. Leave blank to let KoboldCPP decide.",
		min: 1,
		group: "KoboldCPP"
	},
	sdQuant: {
		type: "enum",
		of: SD_QUANT_CHOICES,
		label: "Image model quantisation",
		description:
			"Quantise the image model as it loads, trading quality for VRAM. Applied at load, so changing it costs a reload.",
		default: "off",
		group: "KoboldCPP"
	}
}

const PROFILE_DEFAULTS = {
	...a1111.profileDefaults,
	// No sdThreads default: absent means "koboldcpp decides", which is a better
	// answer than any number this app could pick for an unknown machine.
	sdQuant: "off"
}

/** Where the Manager says its koboldcpp is — never the row's own column. */
function managerBaseUrl(
	settings: { koboldCppManagerBaseUrl?: string | null } | undefined,
	connection: SelectConnection
): string {
	return (
		normalizeBaseUrl(settings?.koboldCppManagerBaseUrl) ||
		normalizeBaseUrl(connection.baseUrl) ||
		DEFAULT_BASE_URL
	)
}

/**
 * Is the Manager up, and is the model this row names actually there?
 *
 * Deliberately NOT "can it draw right now". The image model is loaded on demand
 * at render time, exactly as an LLM is, so a process holding a text model is the
 * expected state and asking `/sdapi/v1/txt2img` about it would fail a connection
 * that works.
 *
 * `ok: true` with no model chosen, on purpose. `connections:test` only calls
 * `listModels` when the test passes, and that list is what fills the form's
 * Checkpoint dropdown — so failing an unconfigured connection would leave the
 * person with nothing to choose from and no way out of it.
 */
async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings?.koboldCppManagerEnabled)
			return {
				ok: false,
				error: "The KoboldCPP Manager is disabled. Enable it in Settings — this connection type has no server of its own to reach."
			}

		// Not answering is only a FAULT in external mode, and the rule is the
		// preflight's own: the Manager starts its own subprocess on demand, so a
		// cold instance is the expected state and failing the test for it would
		// be the same mistake as asking `/sdapi/v1/sd-models` — a working
		// connection reported broken because nothing has needed it yet. In
		// external mode nobody is going to start it, so silence is the answer.
		const baseUrl = managerBaseUrl(settings, connection)
		const reachable = await pingKoboldCPP(baseUrl, 5000)
		if (!reachable && settings.koboldCppManagedMode !== "managed")
			return {
				ok: false,
				error: `Nothing is answering at ${baseUrl}, and the Manager is in "${settings.koboldCppManagedMode ?? "unset"}" mode, so it will not start one. Start KoboldCPP yourself, or switch the Manager to Managed mode in Settings.`
			}

		if (connection.model) {
			// On disk, not in the models table: the file is what koboldcpp opens,
			// and a row can outlive it. `mustExist` also runs the containment
			// check, so a filename that is not a bare name in the image
			// directory fails here rather than at render time.
			let resolved: string | null = null
			try {
				resolved = await resolveModelPath(
					"image",
					connection.model,
					settings,
					{ mustExist: true }
				)
			} catch {
				resolved = null
			}
			if (!resolved)
				return {
					ok: false,
					error: `The Manager is up, but the image model "${connection.model}" is not in its models directory. Pick another in the KoboldCPP Manager's Models tab, or clear this connection's Checkpoint field and test again to list what is there.`
				}
		}

		return {
			ok: true,
			extra: {
				// The PROBE layer. It says nothing new — the manifest already
				// declares this type natively image-capable, which is what makes
				// it usable before anything has ever been loaded — but a probe
				// that contradicted the manifest by staying silent would read as
				// a downgrade the first time someone pressed Test.
				capabilities: { "text->image": "native" },
				// Whether anything is listening right now. Reported rather than
				// judged: in managed mode the answer is usually no, and that is
				// not a fault.
				running: reachable
			}
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

/**
 * The image models the Manager knows about — what fills the Checkpoint dropdown.
 *
 * Not the server's checkpoint list (it has none) and not a directory scan: the
 * `koboldcpp_models` table is what the Manager's own listing maintains, kind and
 * all, and reading it here means the two screens cannot disagree about what
 * exists.
 *
 * `kind: "unknown"` is excluded, unlike in the Manager itself. There a file the
 * classifier could not read shows in both lists with an "Unverified" badge and a
 * one-click override; a bare `<select>` has neither, so an unknown offered here
 * would be indistinguishable from a verified one and would fail at load. The
 * route for a new architecture is to mark it in the Manager, which is also where
 * the evidence for the decision is.
 */
async function listModels(
	connection: SelectConnection
): Promise<{ models: string[]; error?: string }> {
	try {
		const rows = await db.query.koboldCppModels.findMany()
		const models = rows
			.filter((m) => m.kind === "image" && m.status === "complete")
			.map((m) => m.filename)

		// The connection's OWN model is always listed, whatever its kind says.
		//
		// `unknown` is deliberately selectable in the Manager — overriding an
		// unverified file is exactly how it stops being unverified — so a
		// connection can legitimately name a model this filter drops. Leaving it
		// out makes the settings dropdown render with nothing selected, and the
		// next save writes that emptiness back: the connection silently loses the
		// model a user deliberately chose, and the following render refuses for
		// having none.
		if (connection.model && !models.includes(connection.model))
			models.push(connection.model)

		return { models: models.sort((a, b) => a.localeCompare(b)) }
	} catch (e) {
		return { models: [], error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	// A1111's, unchanged and deliberately not subclassed. The wire format is the
	// same one; everything this type does differently happens before the render
	// starts, in dispatchImage and in the two functions above.
	Adapter: a1111.Adapter,
	listModels,
	testConnection,
	capabilities: a1111.capabilities,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
