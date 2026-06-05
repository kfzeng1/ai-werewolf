# Data Field Contract

This document defines the fields used by the Werewolf engine and model prompts.

## Visible Files

Every model decision receives a role-limited file bundle.

Common files:

- `rules/game_rules.json`
  - `version`: rule version.
  - `speechBoundary`: public speech privacy boundary.
  - `wolf`, `seer`, `witch`, `guard`, `hunter`, `sheriff`, `victory`: role and win-condition rules.
  - Runtime provides this file as a stable system/cache message, not as a dynamic visible file entry.
- `public.json`
  - `room`: `{ day, phase, step, status, winner, playerCount, preset }`.
  - `sheriff`: `{ enabled, id, voteWeight, candidates, history }`.
  - `players`: public player states only. Hidden `role` and `team` are not present.
  - `publicSummary`: compressed public memory.
  - `announcements`, `speeches`, `lastWords`, `votes`, `deaths`, `exiles`, `hunterShots`, `publicClaims`, `publicEvents`.

AI receives a compact public view (`public_ai.json`) instead of the full public file:

- `recentAnnouncements`: last 3, `content` clipped to 100 chars.
- `recentSpeeches`: last 4, `content` clipped to 150 chars.
- `recentLastWords`: last 2, `content` clipped to 160 chars.
- `recentVotes`: last 1 full vote round, reason clipped to 80 chars.
- `recentPublicEvents`: last 6, content clipped to 120 chars and vote event content omitted.
- `publicSummary`: retained and updated after day announcement and exile speech, so smaller recent windows do not remove key public facts.
- `publicClaims`: identity/role/check-style public claims only; votes are kept in `recentVotes` to avoid duplication.
- `players/{id}/private.json`
  - `playerId`, `role`, `roleLabel`, `team`, `winCondition`.
  - `styleProfile`: private style controls: `styleId`, `name`, `languageStyle`, `thinkingStyle`, `conflictStyle`, `voteStyle`, `claimStyle`, `roleFit`, `speechGuidance`.
  - `model`: provider-facing model label.
  - `memory`: recent private memory.
  - `strategyNotes`: private strategy notes.
  - `focusSuspicion`: `{ target, reason, source, updatedAt }`.
  - `identityBoard`: per-player identity board:
    `known` contains locked facts such as self, wolf teammates, wolf knowledge that non-teammates are good-team targets, seer wolf checks, public role reveals; `read` contains mutable private inference for unknown role, threat, and action priority.
  - `readPolicy`: role-specific read policy. Wolves infer power roles, threat, night-kill value, and mislynch routes; good players infer wolf alignment and public claim credibility.
  - `reasoningState`: private self-read used to reduce blind following:
    `currentRead`, recent `evidenceLedger`, `dissentNotes`, and `antiBandwagon`.

Role-owned files:

- `players/{id}/seer_checks.json`
  - `checks[]`: `{ night, target, reason, result, resultLabel, source }`.
- `players/{id}/witch.json`
  - `hasAntidote`, `hasPoison`.
  - `currentNight`: `{ night, canSeeKillTarget, killTarget, canSave, canPoison, availablePoisonTargets, decision }`.
    - This is written before the witch decision is requested.
    - `killTarget` is visible only while `hasAntidote` is true.
    - `decision` is filled after runtime action submission.
  - `actions[]`: `{ night, type, target, reason, source, result }`.
- `players/{id}/guard.json`
  - `currentNight`: `{ night, previousTarget, cannotRepeatTarget, availableTargets, decision }`.
    - This is written before the guard decision is requested.
    - `availableTargets` must exclude `cannotRepeatTarget` when present.
    - `decision` is filled after runtime action submission.
  - `actions[]`: `{ night, target, reason, source, result }`.
- `players/{id}/hunter.json`
  - `hasBullet`, `canShootOnDeath`, `currentDeath`.
  - `shots[]`: `{ day, cause, target, reason, source, result }`.

Wolf-only file:

- `wolf_team.json`
  - `team`, `wolves`, `aliveWolves`, `deadWolves`, `winCondition`, `teamStrategy`.
  - `nightChats[]`: wolf private chat records.
  - `nightKills[]`: final night kill records.

Never include `god_view.json` or `host/host.json` in player decisions.

Decision helper file:

- `players/{id}/model_context.json`
  - `version`: context contract version.
    - `2`: compact anti-hallucination context. `knownFacts`, `unknowns`, and `guidance` may use short machine-readable codes to reduce token cost.
  - `playerId`: acting player id.
  - `task`: current decision task.
  - `access`: explicit readable and denied file list.
    - `rules`: `cached:rules/game_rules.json`.
    - `readable[]`: exact dynamic files the player may read.
    - `readOrder[]`: required reading order. Read `model_context` first, then `private.json` and role-owned private files, then `public.json`.
    - `denied[]`: files the player must not access or cite. Common short values include `other_private`, `other_role`, and `wolf_team.json`.
  - `knownFacts[]`: facts the acting player may treat as true. This combines public facts and role-private facts visible to that player.
    - Compact examples: `state:D2/night/witch_action`, `alive:1,3,5`, `self:4:witch:good`, `wolves:2,8,11`.
  - `unknowns[]`: explicit anti-hallucination boundaries. Items here must not be inferred as facts.
    - Compact examples: `unrevealed_role_is_unknown`, `public_claim_is_not_truth`, `no_wolf_team_or_chat_access`.
  - `legalAction`: task-specific schema and legal target/action lists.
    - Public vote: `{ task, schema, legalTargets, publicOnly, notes }`.
    - Public speech: `{ task, schema, legalFocusTargets, publicOnly }`.
    - Wolf chat: `{ task, schema, legalKillTargets, privateOnly, notes }`.
    - Seer: `{ task, schema, legalTargets, privateOnly }`.
    - Guard: `{ task, schema, legalTargets, cannotRepeatTarget, privateOnly }`.
    - Witch: `{ task, schema, canSave, canPoison, visibleKillTarget, availablePoisonTargets, privateOnly, notes }`.
    - Hunter: `{ task, schema, canShoot, legalTargets, publicResult }`.
  - `publicClaims[]`: public claims and votes. Claims are not truth; they are only things said or done publicly.
  - `guidance[]`: short reminders for using facts, claims, unknowns, and legal actions.
    - Compact examples: `legalAction_first`, `knownFacts=facts;publicClaims=claims;unknowns=no_infer`.

`model_context.json` is generated per acting player and is role-limited. It is intended to reduce hallucination by separating facts, claims, unknowns, and legal actions.

## Role File Access

Rules are cached separately for every role. Dynamic readable files by role:

- Werewolf:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`
  - `wolf_team.json`
- Seer:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`
  - `players/{id}/seer_checks.json`
- Witch:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`
  - `players/{id}/witch.json`
- Guard:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`
  - `players/{id}/guard.json`
- Hunter:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`
  - `players/{id}/hunter.json`
- Villager:
  - `public.json`
  - `players/{id}/private.json`
  - `players/{id}/model_context.json`

Denied for every player decision:

- `god_view.json`
- `host/host.json`
- Other players' `private.json`
- Other players' role files
- Wolf files for non-wolves

## Expected JSON By Task

`day_speech`, `sheriff_speech`, `exile_speech`:

```json
{
  "content": "公开发言文本",
  "focusSuspicion": {
    "target": 4,
    "reason": "一句公开理由"
  }
}
```

`day_vote`:

```json
{
  "target": 4,
  "reason": "一句公开投票理由"
}
```

`wolf_chat`:

```json
{
  "content": "狼队私密夜聊文本",
  "killTarget": 5,
  "reason": "刀口理由"
}
```

`seer_check`, `guard_action`, `hunter_shot`:

```json
{
  "target": 7,
  "reason": "行动理由"
}
```

`witch_action`:

```json
{
  "action": "save",
  "poisonTarget": null,
  "reason": "行动理由"
}
```

`host_review`:

```json
{
  "title": "复盘标题",
  "result": "胜利方",
  "summary": "总结",
  "turningPoints": ["关键转折"],
  "goodSide": ["好人阵营表现"],
  "wolfSide": ["狼人阵营表现"],
  "keyMistakes": ["关键失误"],
  "hostNotes": ["主持人备注"]
}
```

## Validation Rules

- JSON must parse as a single object.
- Public tasks must not expose wolf teammates, night kills, private role files, or wolf chat text.
- `model_context.knownFacts` may be used as factual evidence; `model_context.publicClaims` must be treated as public claims only.
- `model_context.unknowns` must not be contradicted by expected output.
- `model_context.legalAction` must contain the expected task schema and include any expected target in the legal target list.
- Target fields must point to alive legal targets for that task.
- Guard samples must not repeat the previous guarded target.
- Witch samples must not save and poison in the same output.
- The assistant message must match `expected_json` exactly.
- Personality may change tone and risk appetite, but cannot change legal targets or reveal private information in public tasks.
- Quality samples must include `qualityAxes`, `roundEvaluation`, and `personality.qualityType`.
- Legality samples must not include quality scoring fields.
