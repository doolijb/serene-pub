# INVENTORY — session settings (read-only sweep, 2026-11-15)

Facts from an Explore sweep; file:line are starting points, re-verify before building. App paths relative to the
repo; SDK = `../serene-pub-sdk`.

## Where settings are stored

| What | Stored | Declared by |
|---|---|---|
| Name, scenario, tags | `sessions.name`, `.scenario`, `session_tags` | core |
| Lorebook, line, story clock | `sessions.lorebook_id`, `lorebook_branch_id`, `story_clock_*` | core |
| Scenes (mode, triggers, summaries) | `sessions.metadata.scenes` | genre `shape.scenes` default, core form |
| Player label | `metadata.playerLabel` | genre |
| Preset | `sessions.preset_id` (switch also overwrites `genre_fields`, `rigour`; `sessions.ts` ~3694–3720) | core |
| Genre settings | `sessions.genre_fields` | SDK `GenreDecl.shape.fields` |
| Rules, How strict, rules options | `sessions.primary_ruleset`, `.rigour`, `.ruleset_settings` | core-made from genre / ruleset |
| Pipeline cards (step params, Prompt) | `registrations.values` (session scope) | node param fields |
| Pipelines card (Prompt; admin Model, Sampling, On/Off) | `pipeline_node_overrides` (session scope) | node slots |
| Routines (mode, cadence, stacking, caps) | `registrations.*` | registration / cadence |
| Turn order strategy | `pipeline_node_rebinds` | node `expose.swaps` |
| On revision | `sessions.on_revision` | core |
| Session data, retake ask | `sessions.annex` | annex declarations |
| Seats, envoys, bench, guests | `session_characters` / `_personas` / `_guests` | genre shape |

## Layering

- Genre fields: declaration → genre defaults / pins → preset → session. One SDK resolver (`resolveExposure`,
  `sdk/src/exposure.ts` ~193–229), called from four app places (`exposure.ts` ~161, ~388;
  `sessionGenres.ts` ~508–554; `settingsForm.ts` ~642).
- Lock: a layer stores `{value, lock:true}`; resolution stops at the first locked layer; the owner then does not
  see the field (`settingsForm.ts` ~263, ~644), though the docs say read-only (`docs/sessions.md` ~414, ~448).
- Pipeline values: session → preset → genre → instance → author (`values.ts` ~58–101); at run time the lock is
  thrown away (`values.ts` ~128–134).
- New session: a preset's `defaults.genreFields` is pre-filled on the client and sent back as answers, so it is
  stored at session scope (`applyPresetDefaults.ts`; `exposure.ts` ~348–380).

## Timeline

- `lorebooks.timeline_enabled` (default true); a session reads its attached lorebook's switch, else its notes'
  (`lorebooks/timeline.ts` ~59–126).
- Stance today: `GenreDecl.keepsTime` / `timeline: 'required'` (`sdk/src/genres.ts` ~237, ~1202);
  `PresetDefaults.timeline` (`announce.ts` ~337, refusal ~756). Story Minimal sets `timeline:false`; the Lair and
  Dungeon Crawler are `required`.
- A pipeline is not typed against it: `SessionSettingsV1` has no timeline field
  (`sdk/src/sessionSettings.ts` ~40–80); the host's `Reading.timelineOff` is internal and three-valued; only
  `HistoryEntriesV1.timeline?: boolean` is typed; `validate()` checks nothing. The registration door's
  `storyClock` fact is `lorebookId != null` (`door.ts` ~120–128), ignoring the switch and the notes.

## Problems found

1. **Two stores for a session's pipeline values**: `registrations.values` and `pipeline_node_overrides`; the
   Prompt picker writes both; registration values win at run time (`world.ts` ~1025 before ~1066).
2. **Many writers of `genre_fields`**: `sessions:updateSetting`, `sessions:update`, the preset switch,
   `authorsNote.ts` ~176, `resolveVoice.ts` ~431. `rigour` has two.
3. **Preset values copied into the session** at creation and on switch, so later preset changes do not reach it.
4. **Locks**: hidden instead of read-only for the owner; ignored for pipeline values at run time.
5. **Summaries policy** stored in `metadata.scenes` and as a routine mode.
6. **Members see model plumbing**: Prompt pickers; Turn mode "The model".
7. **Dead or unread**: `sessions.world_attributes`, `session_attribute_picks`,
   `user_settings` / `system_settings.on_revision_default`, routine status "Needs a story clock",
   `sessions.session_type` (client-writable through `sessions:update`).
8. **Server and client disagree**: How strict choices narrowed by ruleset only on the client and at creation.
9. **Copy and docs drift**: On revision's text omits moving the clock back; docs promise Tone "Before you start"
   but nothing declares `askAtStart`.
10. **Settings tab is half bespoke**: only the genre / pipeline / routine block is derived from SDK
    declarations; name, scenario, reading, scenes, actions, player label, On revision, rules options, Pipelines
    and tags are hand-built forms.
