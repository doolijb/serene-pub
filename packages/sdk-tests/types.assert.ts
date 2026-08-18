/**
 * Compile-time assertions. This file has no runtime tests — `npm run typecheck` is the
 * test. Every `@ts-expect-error` below fails the build if the error *stops* happening,
 * which is what makes "it's a compile error now" a claim with a regression test behind it.
 *
 * These are the mistakes that used to be publish-time findings, or runtime throws, when
 * references were two strings.
 */

import { spec, fragment } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'

// ── A port the node does not declare ────────────────────────────────────────
spec('types:ports@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.query('history', ($) =>
		C.chatHistory.v1({
			// @ts-expect-error — `chatScopes` is not a port on the Input; the real one is `chatScope`
			scope: $.input.chatScopes,
		}),
	)

// The correct spelling type-checks, so the assertion above is about the typo and not
// about the whole expression being rejected.
spec('types:ports-ok@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))

// ── A node that does not exist ──────────────────────────────────────────────
spec('types:unknown@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.query('history', ($) =>
		C.chatHistory.v1({
			// @ts-expect-error — no node named `histry` has been declared
			scope: $.histry.messages,
		}),
	)

// ── A forward reference: F9 as a compile error ──────────────────────────────
spec('types:forward@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.query('history', ($) =>
		C.chatHistory.v1({
			// @ts-expect-error — `generate` is declared *below*; the scope contains only
			// what precedes this call, so a back-edge is unwritable rather than caught later
			scope: $.generate.text,
		}),
	)
	.provider('generate', () => C.generateText.v1({ connection: slot.connection() }))

// ── The kind is still named, and still checked ──────────────────────────────
spec('types:kind@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	// @ts-expect-error — a Provider constructor handed to .query()
	.query('generate', () => C.generateText.v1({ connection: slot.connection() }))

// ── Scope inside a block sees the spine, and its own siblings ───────────────
spec('types:block@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.async('gather', { mode: 'parallel' }, (b) =>
		b.chain('semantic', (c) =>
			c
				.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() }))
				// A sibling by its qualified key. Block members accumulate into the type
				// under the key they actually get in the rows.
				.query('vsearch', ($) => C.vectorSearch.v1({ vector: $.gather.semantic.embed.vector })),
		),
	)
	// And from the spine afterwards — the block's nodes are in scope, nested.
	.task('merge', ($) => C.mergeCandidates.v1({ sources: [$.gather.semantic.vsearch.hits] }))

spec('types:block-bad@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.async('gather', { mode: 'parallel' }, (b) =>
		b.chain('semantic', (c) =>
			c.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() })),
		),
	)
	.task('merge', ($) =>
		C.mergeCandidates.v1({
			// @ts-expect-error — `sematic` is misspelled; block paths are checked like any other
			sources: [$.gather.sematic.embed.vector],
		}),
	)

// A block name alone is a path, not a ref — only the leaf is a node.
spec('types:block-leaf@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.async('gather', { mode: 'parallel' }, (b) =>
		b.chain('semantic', (c) =>
			c.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() })),
		),
	)
	.task('merge', ($) =>
		C.mergeCandidates.v1({
			// @ts-expect-error — `gather` is a block, so it has no `vector` port
			sources: [$.gather.vector],
		}),
	)

// ── A map's members, and the current item ──────────────────────────────────
spec('types:map@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.task('chunks', ($) => C.chunkText.v1({ text: $.input.text }))
	.map('summarize', { over: ($) => $.chunks.items, max: 64 }, (m) =>
		m.provider('sum', ($) => C.generateText.v1({ text: $.$item, connection: slot.connection() })),
	)
	.task('collect', ($) => C.toCandidates.v1({ items: $.summarize.item.sum.text }))

// ── A fragment's nodes arrive namespaced by the include key ────────────────
const ctx = fragment('demo:frag/ctx@1', (c) =>
	c
		.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
		.task('merge', ($) => C.mergeCandidates.v1({ sources: [$.lore.hits] })),
)

spec('types:include@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.include('ctx', ctx)
	.task('prompt', ($) => C.assemble.v2({ candidates: $.ctx.merge.candidates }))

spec('types:include-bad@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.include('ctx', ctx)
	.task('prompt', ($) =>
		C.assemble.v2({
			// @ts-expect-error — the fragment has no `rank` node, even under the right key
			candidates: $.ctx.rank.candidates,
		}),
	)

// ── A config reference takes the accessor, not a second spelling of the key ─
spec('types:slotref@1', { version: '1.0.0' })
	.input('input', C.userMessage.v1())
	.provider('generate', () => C.generateText.v1({ connection: slot.connection() }))
	.task('budget', ($) => C.contextBudget.v1({ connection: slot.connectionOf($.generate) }))

export {}
