/**
 * Audio families - the shapes of `audio-families.yaml`, the shipped snapshot of
 * it, and the PURE matcher that decides which family a model belongs to.
 *
 * Client-safe on purpose: no node imports, no YAML library. The server reads
 * the live list (`server/audio/audioList.ts`); the shipped catalogues under
 * `shared/speech/catalogues` call `matchAudioFamily` with
 * `AUDIO_FAMILIES_SNAPSHOT` (★A11), so a browser can tell a Kokoro model from a
 * Qwen3-TTS one with no round trip.
 *
 * ## The matching rule
 *
 * Five signals, each a yes/no per family:
 *   gguf      the GGUF header's `audiocpp.model_spec.family` is in `gguf_families`,
 *             or its `general.architecture` is in `gguf_architectures`
 *   repo      the Hugging Face repo id matches a `repos` regex
 *   file      a file name or path matches a `files` regex
 *   pipeline  the repo's pipeline tag is in `hf_pipeline_tags`
 *   tag       one of the repo's tags is in `hf_tags`
 * A family needs at least one of gguf, repo or file to be a candidate at all:
 * `pipeline` and `tag` only corroborate (every text-to-speech family shares
 * the same pipeline tag). A candidate is STRONG when it has the gguf signal, or
 * repo/file plus a second independent signal (repo AND file, or either with
 * pipeline or tag); one weak signal alone is a guess. Strong beats weak, then
 * more signals beat fewer, then list order decides.
 */

export type AudioTask = "tts" | "asr" | "vdes"
export type AudioVoices = "catalogue" | "listed" | "none"

export interface AudioFamilyMatch {
	repos: string[]
	files: string[]
	ggufArchitectures: string[]
	ggufFamilies: string[]
	hfPipelineTags: string[]
	hfTags: string[]
}

export interface AudioFamilyVariant {
	variant: string
	/** Overrides the family's default task (VoiceDesign is `vdes`). */
	task?: AudioTask
	match: { repos: string[]; files: string[] }
}

export interface AudioFamily {
	family: string
	tasks: AudioTask[]
	runner: string
	voices: AudioVoices
	match: AudioFamilyMatch
	variants?: AudioFamilyVariant[]
}

export interface FamilyGuess {
	task: AudioTask
	family: string
	variant?: string
	confidence: "listed" | "matched" | "guessed"
}

/** What is known about a model; every field optional. */
export interface AudioSignals {
	repoId?: string
	/** File names or repo-relative paths. */
	files?: string[]
	pipelineTag?: string
	tags?: string[]
	ggufArchitecture?: string
	/** `audiocpp.model_spec.family` from the GGUF header. */
	ggufFamily?: string
}

export interface FamilyMatchResult {
	family: AudioFamily
	task: AudioTask
	variant?: string
	confidence: "matched" | "guessed"
}

const regexCache = new Map<string, RegExp | null>()

function compile(source: string): RegExp | null {
	let r = regexCache.get(source)
	if (r === undefined) {
		try {
			r = new RegExp(source, "i")
		} catch {
			r = null
		}
		regexCache.set(source, r)
	}
	return r
}

const anyMatch = (patterns: readonly string[], subjects: readonly string[]) =>
	subjects.length > 0 &&
	patterns.some((p) => {
		const r = compile(p)
		return r !== null && subjects.some((s) => r.test(s))
	})

const lower = (xs: readonly string[] | undefined) =>
	(xs ?? []).map((x) => x.toLowerCase())

function variantOf(
	family: AudioFamily,
	repos: string[],
	files: string[]
): AudioFamilyVariant | undefined {
	return (family.variants ?? []).find(
		(v) => anyMatch(v.match.repos, repos) || anyMatch(v.match.files, files)
	)
}

/** The family a set of signals names, or null. Pure; see the module header. */
export function matchAudioFamily(
	families: readonly AudioFamily[],
	signals: AudioSignals
): FamilyMatchResult | null {
	const repos = signals.repoId ? [signals.repoId] : []
	const files = (signals.files ?? []).filter(Boolean)
	const tags = lower(signals.tags)
	const pipeline = signals.pipelineTag?.toLowerCase()
	const arch = signals.ggufArchitecture?.toLowerCase()
	const gfam = signals.ggufFamily?.toLowerCase()

	let best: { family: AudioFamily; strong: boolean; score: number } | null =
		null
	for (const family of families) {
		const m = family.match
		const gguf =
			(gfam !== undefined && lower(m.ggufFamilies).includes(gfam)) ||
			(arch !== undefined && lower(m.ggufArchitectures).includes(arch))
		const repo = anyMatch(m.repos, repos)
		const file = anyMatch(m.files, files)
		if (!gguf && !repo && !file) continue
		const pipe = pipeline !== undefined && lower(m.hfPipelineTags).includes(pipeline)
		const tag = tags.some((t) => lower(m.hfTags).includes(t))
		const score = [gguf, repo, file, pipe, tag].filter(Boolean).length
		const strong = gguf || ((repo || file) && score >= 2)
		if (
			!best ||
			(strong && !best.strong) ||
			(strong === best.strong && score > best.score)
		)
			best = { family, strong, score }
	}
	if (!best) return null
	const { family } = best
	const variant = variantOf(family, repos, files)
	const task: AudioTask =
		variant?.task ??
		(pipeline === "automatic-speech-recognition" && family.tasks.includes("asr")
			? "asr"
			: (family.tasks[0] ?? "tts"))
	return {
		family,
		task,
		...(variant ? { variant: variant.variant } : {}),
		confidence: best.strong ? "matched" : "guessed"
	}
}

/**
 * The shipped copy of `audio-families.yaml` as data. A test asserts it deep-equals the parsed
 * `server/audio/snapshot/audio-families.yaml`; regenerate both together.
 */
export const AUDIO_FAMILIES_SNAPSHOT: AudioFamily[] = [
	{
		"family": "kokoro_tts",
		"tasks": [
			"tts"
		],
		"runner": "audiocpp",
		"voices": "catalogue",
		"match": {
			"repos": [
				"kokoro"
			],
			"files": [
				"kokoro"
			],
			"ggufArchitectures": [],
			"ggufFamilies": [
				"kokoro_tts"
			],
			"hfPipelineTags": [
				"text-to-speech"
			],
			"hfTags": [
				"kokoro"
			]
		}
	},
	{
		"family": "qwen3_tts",
		"tasks": [
			"tts",
			"vdes"
		],
		"runner": "audiocpp",
		"voices": "catalogue",
		"match": {
			"repos": [
				"qwen3[-_. ]?tts"
			],
			"files": [
				"qwen3[-_. ]?tts"
			],
			"ggufArchitectures": [],
			"ggufFamilies": [
				"qwen3_tts"
			],
			"hfPipelineTags": [
				"text-to-speech"
			],
			"hfTags": [
				"qwen3-tts",
				"qwen3_tts"
			]
		},
		"variants": [
			{
				"variant": "voicedesign",
				"task": "vdes",
				"match": {
					"repos": [
						"voice[-_. ]?design"
					],
					"files": [
						"voice[-_. ]?design"
					]
				}
			},
			{
				"variant": "customvoice",
				"match": {
					"repos": [
						"custom[-_. ]?voice"
					],
					"files": [
						"custom[-_. ]?voice"
					]
				}
			},
			{
				"variant": "base",
				"match": {
					"repos": [
						"[-_. ]base([-_. ]|$)"
					],
					"files": [
						"[-_. ]base([-_. ]|$)"
					]
				}
			}
		]
	},
	{
		"family": "kitten_tts2",
		"tasks": [
			"tts"
		],
		"runner": "audiocpp",
		"voices": "catalogue",
		"match": {
			"repos": [
				"kitten[-_. ]?tts[-_. ]?2"
			],
			"files": [
				"kitten[-_. ]?tts[-_. ]?2"
			],
			"ggufArchitectures": [],
			"ggufFamilies": [
				"kitten_tts2"
			],
			"hfPipelineTags": [
				"text-to-speech"
			],
			"hfTags": [
				"kitten-tts",
				"kittentts"
			]
		}
	},
	{
		"family": "parakeet_tdt",
		"tasks": [
			"asr"
		],
		"runner": "audiocpp",
		"voices": "none",
		"match": {
			"repos": [
				"parakeet[-_. ]?tdt"
			],
			"files": [
				"parakeet[-_. ]?tdt"
			],
			"ggufArchitectures": [],
			"ggufFamilies": [
				"parakeet_tdt"
			],
			"hfPipelineTags": [
				"automatic-speech-recognition"
			],
			"hfTags": [
				"parakeet"
			]
		}
	},
	{
		"family": "qwen3_asr",
		"tasks": [
			"asr"
		],
		"runner": "audiocpp",
		"voices": "none",
		"match": {
			"repos": [
				"qwen3[-_. ]?asr"
			],
			"files": [
				"qwen3[-_. ]?asr"
			],
			"ggufArchitectures": [],
			"ggufFamilies": [
				"qwen3_asr"
			],
			"hfPipelineTags": [
				"automatic-speech-recognition"
			],
			"hfTags": [
				"qwen3-asr",
				"qwen3_asr"
			]
		}
	}
]
