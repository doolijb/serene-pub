# REPORT hist-B2-w1
Status line: done, all listed tests green.

## Changed
- pipelines/runtime/castMember.ts: `checkChanges` accepts `nodeState` (CAST_STATE_WORDS) and `nodeVisibility` (module const NODE_VISIBILITIES); follow on either refused. Imports CAST_STATE_WORDS (value) from sdk and type NodeVisibility. profileOf ignores unknown keys, so writeCastMember needed no change.
- castMember.int.test.ts: refusals line replaced by three; new "a node visibility lands with the turn" test.
- castMember.nodeState.int.test.ts (new): write deceased at turn, row date 5/3/7 = story clock, sourceMessageId = anchor; rewindTurn takes it, member reads active again.
- sockets/scenes.ts: compile call maps scenes (notes beside non-blank summary); processScene builds `sceneNotes` and puts `notes` into request.scene only when non-empty (+ the queued-transcript comment).
- sockets/scenes.notes.int.test.ts (new): compile and summarize-request tests; only `runSpec` (runTurn) and compileScenesForEntry are mocked, processScene runs fully to the receipt and beyond.
- db/sceneNotes0150.int.test.ts (new): 0149 -> real folder, notes null, array reads back, second boot unchanged.

## Sentences added (all marked provisional in a comment)
- `'${value}' is not a cast state; a cast member's state is one of active, deceased, missing, departed.`
- `'${value}' is not a cast visibility; it is one of normal, legendary, hidden.`
- `'${key}' has no card value to follow; give it a value.`
- Compile label "Noted in this scene:" (as briefed).

## Tests run
castMember.int, castMember.nodeState.int, castMember.sdkShape: 12 passed. scenes.notes.int, sceneNotes0150.int, scenes.compileForksRiding.int, scenes.compileLine.int, scenes.summaryReview.int: 50 passed.

## Prettier --check
castMember.ts, castMember.int.test.ts, castMember.nodeState.int.test.ts: clean. scenes.ts, scenes.notes.int.test.ts, sceneNotes0150.int.test.ts: warn (not fixed per rules; scenes.ts has other uncommitted work so it may have been unformatted before my hunks).

## Decisions
- Blank-text notes are filtered in both compile and request. Notes order is stored order (assumed oldest first).
- Test tmp dirs are removed by afterAll (releaseDataDir / fs.rm).

## Noticed, not done
- transcript.ts `sceneOf` does not render scene.notes yet (queued).
