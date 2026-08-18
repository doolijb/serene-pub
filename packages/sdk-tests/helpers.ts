import { compile, type SpecDocument } from '@serene-pub/sdk'
import { assertValid, validate, type Finding } from '@serene-pub/sdk'
import type { SpecBuilder } from '@serene-pub/sdk'
import { ok, halt, err, type Bindings, type Result } from '@serene-pub/sdk'
import type { ConfigWorld } from '@serene-pub/sdk'

export function publish(b: SpecBuilder<any>): SpecDocument {
	const doc = compile(b.build())
	assertValid(doc)
	return doc
}

export function findings(b: SpecBuilder<any>): Finding[] {
	return validate(compile(b.build()))
}

export function errorsFor(b: SpecBuilder<any>, law: string): Finding[] {
	return findings(b).filter((f) => f.severity === 'error' && f.law === law)
}

/** A clock we control, so "waiting" can be simulated without real delay. */
export function fakeClock(start = 1_000_000) {
	let t = start
	return { now: () => t, advance: (ms: number) => (t += ms) }
}

export const world: ConfigWorld = {
	overrides: [],
	samplingConfigs: [
		{ id: 'cfg_creative', name: 'Creative', shape: 'core:shape/text-gen@1', values: { temperature: 0.92, top_p: 0.95, mirostat_tau: 5 } },
		{ id: 'cfg_precise', name: 'Precise', shape: 'core:shape/text-gen@1', values: { temperature: 0.2 } },
		{ id: 'cfg_voice', name: 'Aria', shape: 'core:shape/tts@1', values: { voice: 'aria', speed: 1 } },
	],
	connections: [
		{
			id: 'ollama-local',
			name: 'Ollama',
			kind: 'core:shape/text-gen@1',
			metadata: { contextLength: 4096, tokenizer: 'llama-bpe', model: 'llama3', supportedSamplers: ['temperature', 'top_p'] },
			material: { apiKey: 'SECRET-DO-NOT-LEAK' },
		},
		{
			id: 'tts-eleven',
			name: 'ElevenLabs',
			kind: 'core:shape/tts@1',
			metadata: { model: 'eleven-v2' },
			material: { apiKey: 'SECRET-TTS' },
		},
	],
	activeConnection: {
		'core:shape/text-gen@1': 'ollama-local',
		'core:shape/tts@1': 'tts-eleven',
		'core:shape/embeddings@1': null, // no embeddings connection — auto falls back to keyword
	},
	authorDefaults: {},
}

export function withEmbeddings(): ConfigWorld {
	return {
		...world,
		connections: [
			...world.connections,
			{
				id: 'embed-local',
				name: 'MiniLM',
				kind: 'core:shape/embeddings@1',
				metadata: { model: 'all-MiniLM-L6-v2' },
				material: { apiKey: 'SECRET-EMB' },
			},
		],
		activeConnection: { ...world.activeConnection, 'core:shape/embeddings@1': 'embed-local' },
	}
}

/** Default bindings — deterministic, so goldens are stable. */
export function bindings(over: Bindings = {}): Bindings {
	const base: Bindings = {
		'core:input/user-message@1': async (i) => ok(i),
		'core:input/message-created@1': async (i) => ok(i),

		'core:query/chat-history@1': async (i: any) =>
			ok({
				main: 'history',
				messages: {
					sourceKey: 'history',
					items: Array.from({ length: 12 }, (_, n) => `msg${n}`),
					weight: i.params?.weight ?? 0.4,
					minInclude: i.params?.minInclude ?? 6,
					priority: 'normal',
				},
			}),

		'core:query/lorebook-triggers@1': async (i: any) =>
			ok({
				main: 'lore',
				hits: { sourceKey: 'lore', items: ['elf', 'sister', 'castle'], weight: i.params?.weight ?? 0.35, minInclude: 3, priority: 'high' },
			}),

		'core:query/lorebook-probabilistic@1': async (_i, ctx: any) => {
			const entries = ['a', 'b', 'c', 'd', 'e', 'f']
			const won = entries.filter(() => ctx.random() < 0.5)
			return ok({ main: 'prob', hits: { sourceKey: 'prob', items: won, weight: 0.2, minInclude: 0 } })
		},

		'core:query/vector-search@1': async (i: any) => {
			if (!i.vector) return ok({ main: 'vsearch', hits: { sourceKey: 'vector', items: [], weight: 0.3, minInclude: 0 } })
			return ok({ main: 'vsearch', hits: { sourceKey: 'vector', items: ['v1', 'v2'], weight: 0.3, minInclude: 0 } })
		},

		'core:query/persona-card@1': async () => ok({ main: 'persona', card: { sourceKey: 'persona', items: ['Mira'], weight: 0.25, minInclude: 0 } }),
		'core:query/message-text@1': async () => ok({ main: 'text', plain: 'the raw message text' }),

		'core:provider/embed-text@1': async (i: any, ctx: any) => {
			const enabled = i.params?.enabled ?? 'auto'
			if (enabled === 'off') return ok({ main: null, vector: null })
			if (!i.connection) {
				ctx.log('info', 'no active embeddings connection, returned null')
				return ok({ main: null, vector: null })
			}
			return ok({ main: [0.1, 0.2, 0.3], vector: [0.1, 0.2, 0.3] })
		},

		'core:task/context-budget@1': async (i: any) => {
			const ctxLen = i.connection?.metadata?.contextLength ?? 2048
			const reserve = i.params?.reserveForReply ?? 512
			return ok({ main: ctxLen - reserve, available: ctxLen - reserve, tokenizer: i.connection?.metadata?.tokenizer })
		},

		'core:task/merge-candidates@1': async (i: any) => {
			const sources = (i.sources ?? []).filter(Boolean)
			const hasVectors = sources.some((s: any) => s?.sourceKey === 'vector' && s.items.length > 0)
			const declared = i.params?.strategy ?? 'auto'
			const resolved = declared === 'auto' ? (hasVectors ? 'vector' : 'keyword') : declared
			const kept = sources.filter((s: any) =>
				resolved === 'vector' ? s.sourceKey !== 'lore' : resolved === 'keyword' ? s.sourceKey !== 'vector' : true,
			)
			return ok({ main: kept, candidates: kept, strategyResolved: resolved })
		},

		'core:task/rank-hybrid@1': async (i: any) => ok({ main: i.candidates, candidates: i.candidates }),
		'core:task/rank-by-recency@1': async (i: any) => ok({ main: i.candidates, candidates: i.candidates }),
		'chariot.recall:rank-semantic@1': async (i: any) => ok({ main: i.candidates, candidates: i.candidates }),
		'core:task/render-entries@1': async (i: any) => ok({ main: `rendered(${i.entries?.items?.length ?? 0})` }),
		'core:task/to-candidates@1': async (i: any) => {
			const items = Array.isArray(i.items) ? i.items : [i.items].filter(Boolean)
			const block = { sourceKey: 'summaries', items, weight: 0.5, minInclude: 0, priority: 'normal' }
			return ok({ main: block, candidates: block })
		},
		'core:consumer/attach-image@1': async (i: any, ctx: any) => {
			const row = await ctx.commit({ image: i.image })
			return ok({ main: row.id })
		},

		'core:task/assemble@2': async (i: any) => {
			const budget = i.budget ?? i.params?.budget ?? 4096
			const raw = i.candidates ?? []
			const blocks = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
			const alloc = blocks.map((b: any) => ({
				sourceKey: b.sourceKey,
				weight: b.weight,
				minInclude: b.minInclude,
				included: Math.max(b.minInclude ?? 0, Math.floor(b.items.length * (b.weight ?? 0))),
				available: b.items.length,
			}))
			const dropped = alloc.reduce((n: number, a: any) => n + (a.available - a.included), 0)
			return ok({ main: { budget, alloc, dropped }, context: { budget, alloc, dropped } })
		},

		'core:task/chunk-text@1': async (i: any) => {
			const items = String(i.text ?? '').split('|')
			return ok({ main: items, items })
		},

		'chariot.dice-tray:roll@1': async (i: any, ctx: any) => {
			const n = Number(String(i.notation ?? '1d20').split('d')[1] ?? 20)
			const total = Math.floor(ctx.random() * n) + 1
			return ok({ main: total, total })
		},

		'core:provider/generate-text@1': async (i: any, ctx: any) => {
			const supported = new Set(i.connection?.metadata?.supportedSamplers ?? [])
			const applied: Record<string, unknown> = {}
			const ignored: string[] = []
			for (const [k, v] of Object.entries(i.sampling ?? {})) {
				if (supported.size === 0 || supported.has(k)) applied[k] = v
				else ignored.push(k)
			}
			ctx.reportSampling(applied, ignored)
			ctx.reportUsage(214)
			await ctx.call({ context: i.context, sampling: applied })
			return ok({ main: 'the reply text', text: 'the reply text' })
		},

		'core:provider/speak@1': async (i: any, ctx: any) => {
			ctx.reportUsage(1)
			return ok({ main: 'audio:blob', audio: 'audio:blob' })
		},

		'chariot.comfy:render-image@1': async (_i, ctx: any) => {
			ctx.reportUsage(1)
			return ok({ main: 'image:blob', image: 'image:blob' })
		},

		'core:provider/mcp-tool@1': async (i: any, ctx: any) => {
			ctx.reportUsage(1)
			await ctx.call(i.args)
			return ok({ main: { done: true }, result: { done: true } })
		},

		'core:task/first-json@1': async () => ok({ main: { early: true } }),
		'test:task/sloppy-stream@1': async () => ok({ main: { early: true } }),
		'test:task/gate@1': async () => ok({ main: 'passed' }),
		'test:task/passthrough@1': async (i: any) => ok({ main: i.main }),
		'test:task/bad-toggleable@1': async () => ok({ main: null }),
		'test:query/network@1': async (_i, ctx: any) => {
			if ('fetch' in ctx) return err('a Query reached the network')
			return ok({ main: 'no network handle available' })
		},
		'test:task/slow@1': async () => {
			await new Promise((r) => setTimeout(r, 200))
			return ok({ main: 'too late' })
		},

		'core:consumer/create-message@1': async (i: any, ctx: any) => {
			const row = await ctx.commit({ text: i.text })
			return ok({ main: row.id, messageId: row.id })
		},
		'core:consumer/attach-audio@1': async (i: any, ctx: any) => {
			const row = await ctx.commit({ audio: i.audio })
			return ok({ main: row.id })
		},
		'core:consumer/save-plugin-data@1': async (i: any, ctx: any) => {
			const row = await ctx.commit({ value: i.value })
			return ok({ main: row.id })
		},
		'core:consumer/emit-socket@1': async (i: any, ctx: any) => {
			ctx.emit(String(i.handle ?? 'unnamed'), i.from)
			return ok({ main: 'emitted' })
		},
	}
	return { ...base, ...over }
}

export const H = { ok, halt, err }
export type { Result }
