import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceStep,
  alivePlayers,
  applyInitialSetup,
  createDefaultSetup,
  createRoom,
  PERSONA_STYLES,
  resolveSheriffBadge,
  resolveSheriffElection,
  sanitizePublicText,
} from '../src/game/engine.js'
import { visibleFilesFor } from '../src/game/files.js'
import { ROOM_RULES } from '../src/game/rooms/index.js'
import { buildContextProjection } from '../src/comms/contextProjection.js'
import { publicSpeechPrompt } from '../src/agents/prompts.js'
import { validateDecision, validatePublicText } from '../src/agents/validators.js'

const findPlayer = (room, role) => room.players.find((player) => player.role === role)

test('room files separate public, private, and role-owned files', () => {
  const room = createRoom(12)
  const seer = findPlayer(room, 'seer')
  const witch = findPlayer(room, 'witch')
  const guard = findPlayer(room, 'guard')
  const hunter = findPlayer(room, 'hunter')
  const wolf = findPlayer(room, 'werewolf')
  const villager = findPlayer(room, 'villager')

  assert.ok(room.files['public.json'])
  assert.ok(room.files['public_ai.json'])
  assert.ok(room.files['rules/game_rules.json'])
  assert.ok(room.files['god_view.json'])
  assert.ok(room.files['wolf_team.json'])
  assert.ok(room.files[`players/${seer.id}/seer_checks.json`])
  assert.ok(room.files[`players/${witch.id}/witch.json`])
  assert.ok(room.files[`players/${guard.id}/guard.json`])
  assert.ok(room.files[`players/${hunter.id}/hunter.json`])
  assert.ok(room.files['public_ai.json'].publicSummary)
  assert.ok(Array.isArray(room.files['public_ai.json'].recentPublicEvents))
  assert.equal(Object.hasOwn(room.files['public_ai.json'], 'publicEvents'), false)
  assert.equal(Object.hasOwn(room.files['public_ai.json'], 'ruleNotes'), false)
  assert.equal(room.files['rules/game_rules.json'].wolf.selfKillAllowed, true)
  assert.deepEqual(room.godView.debug.aiCalls, [])

  assert.equal(room.files[`players/${villager.id}/private.json`].role, 'villager')
  assert.equal(room.files[`players/${wolf.id}/private.json`].team, 'wolf')
  assert.equal(Object.hasOwn(room.files[`players/${seer.id}/private.json`], 'mbti'), false)
  assert.equal(Object.hasOwn(room.files[`players/${seer.id}/private.json`], 'type'), false)
  assert.equal(typeof room.files[`players/${seer.id}/private.json`].styleProfile.styleId, 'string')
  assert.equal(typeof room.files[`players/${seer.id}/private.json`].styleProfile.languageStyle, 'string')
  assert.equal(typeof room.files[`players/${seer.id}/private.json`].styleProfile.thinkingStyle, 'string')
  assert.deepEqual(Object.keys(room.files[`players/${seer.id}/private.json`].focusSuspicion).sort(), ['reason', 'source', 'target', 'updatedAt'])
  assert.equal(typeof room.files[`players/${seer.id}/private.json`].reasoningState.currentRead.target, 'number')
  assert.equal(room.files[`players/${seer.id}/private.json`].reasoningState.antiBandwagon.requireOwnEvidence, true)
  assert.equal(room.files[`players/${villager.id}/private.json`].identityBoard.find((item) => item.playerId === villager.id).known.locked, true)
  assert.equal(room.files[`players/${villager.id}/private.json`].identityBoard.find((item) => item.playerId === wolf.id).known.role, 'unknown')
  assert.equal(room.files[`players/${wolf.id}/private.json`].identityBoard.find((item) => item.playerId === wolf.id).known.role, 'werewolf')
  assert.equal(room.files[`players/${wolf.id}/private.json`].identityBoard.find((item) => item.playerId === villager.id).known.team, 'good')
  assert.equal(room.files[`players/${wolf.id}/private.json`].identityBoard.find((item) => item.playerId === villager.id).read.actionPriority, 'infer_power_role')

  for (const publicPlayer of room.files['public.json'].players) {
    assert.equal(publicPlayer.publicRoleRevealed, null)
    assert.equal(Object.hasOwn(publicPlayer, 'role'), false)
    assert.equal(Object.hasOwn(publicPlayer, 'team'), false)
  }
})

test('identity board separates locked facts from mutable reads', () => {
  const room = createRoom(12)
  const seer = findPlayer(room, 'seer')
  const wolf = findPlayer(room, 'werewolf')
  const setup = { ...createDefaultSetup(room), seerCheckTarget: wolf.id }
  const started = applyInitialSetup(room, setup)
  const seerPrivate = started.files[`players/${seer.id}/private.json`]
  const wolfFact = seerPrivate.identityBoard.find((item) => item.playerId === wolf.id)

  assert.deepEqual(wolfFact.known, { team: 'wolf', role: 'werewolf', locked: true, source: 'seer_check_N1' })
  assert.equal(wolfFact.read, null)

  const villager = findPlayer(started, 'villager')
  const villagerFact = seerPrivate.identityBoard.find((item) => item.playerId === villager.id)
  assert.equal(villagerFact.known.locked, false)
  assert.equal(villagerFact.known.role, 'unknown')
  assert.equal(villagerFact.read.alignment, 'unknown')

  const goodCheckRoom = createRoom(12)
  const goodSeer = findPlayer(goodCheckRoom, 'seer')
  const goodTarget = goodCheckRoom.players.find((player) => player.team === 'good' && player.id !== goodSeer.id)
  const goodStarted = applyInitialSetup(goodCheckRoom, { ...createDefaultSetup(goodCheckRoom), seerCheckTarget: goodTarget.id })
  const goodFact = goodStarted.files[`players/${goodSeer.id}/private.json`].identityBoard.find((item) => item.playerId === goodTarget.id)
  assert.equal(goodFact.known.team, 'good')
  assert.equal(goodFact.known.role, 'unknown')
  assert.equal(goodFact.known.locked, true)
  assert.match(goodFact.known.note, /非狼人/)
})

test('seer speech prompt preserves not-wolf check result', () => {
  const room = createRoom(6)
  const seer = findPlayer(room, 'seer')
  const good = room.players.find((player) => player.team === 'good' && player.id !== seer.id)
  room.roleFiles.seer[seer.id].checks.push({ night: 1, target: good.id, result: 'not_wolf', resultLabel: '不是狼人', source: 'test' })

  const prompt = publicSpeechPrompt('白天', room, seer)

  assert.match(prompt, new RegExp(`${good.id}号不是狼人`))
  assert.doesNotMatch(prompt, new RegExp(`${good.id}号狼人`))
})

test('visible files are explicit per role and exclude cached rules and denied files', () => {
  const room = createRoom(12)
  const expectedByRole = {
    werewolf: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json', 'wolf_team.json'],
    seer: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json', 'players/{id}/seer_checks.json'],
    witch: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json', 'players/{id}/witch.json'],
    guard: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json', 'players/{id}/guard.json'],
    hunter: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json', 'players/{id}/hunter.json'],
    villager: ['public.json', 'players/{id}/private.json', 'players/{id}/model_context.json'],
  }

  for (const player of room.players) {
    const names = Object.keys(visibleFilesFor(room, player)).sort()
    const expected = expectedByRole[player.role].map((name) => name.replace('{id}', player.id)).sort()
    assert.deepEqual(names, expected)
    assert.equal(names.includes('rules/game_rules.json'), false)
    assert.equal(names.includes('god_view.json'), false)
    assert.equal(names.includes('host/host.json'), false)
    for (const other of room.players.filter((item) => item.id !== player.id)) {
      assert.equal(names.some((name) => name.startsWith(`players/${other.id}/`)), false)
    }

    const context = visibleFilesFor(room, player)[`players/${player.id}/model_context.json`]
    assert.deepEqual(context.access.readable.slice().sort(), expected)
    assert.ok(context.access.denied.includes('god_view.json'))
  }
})

test('private file style profile comes from persona style pool', () => {
  const room = createRoom(12)
  const validStyleIds = new Set(PERSONA_STYLES.map((persona) => persona.id))

  for (const player of room.players) {
    const privateFile = room.files[`players/${player.id}/private.json`]
    assert.ok(validStyleIds.has(privateFile.styleProfile.styleId), `${player.role} got invalid style ${privateFile.styleProfile.styleId}`)
    assert.equal(privateFile.styleProfile.name, player.persona.name)
    assert.equal(privateFile.styleProfile.languageStyle, player.persona.languageStyle)
  }
})

test('room modules keep 6, 9, and 12 player night rules separated', () => {
  assert.deepEqual(ROOM_RULES[6].nightOrder, ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'witch_action', 'day_announcement'])
  assert.deepEqual(ROOM_RULES[9].nightOrder, ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'witch_action', 'day_announcement'])
  assert.deepEqual(ROOM_RULES[12].nightOrder, ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'guard_action', 'witch_action', 'day_announcement'])

  assert.equal(ROOM_RULES[6].enabledRoles.guard, false)
  assert.equal(ROOM_RULES[9].enabledRoles.guard, false)
  assert.equal(ROOM_RULES[12].enabledRoles.guard, true)
})

test('role-fit persona styles are weighted higher than off-role styles', () => {
  let roleFit = 0
  let total = 0

  for (let index = 0; index < 300; index += 1) {
    const room = createRoom(12)
    for (const player of room.players) {
      total += 1
      if (player.persona.roleFit?.includes(player.role)) roleFit += 1
    }
  }

  assert.ok(roleFit / total > 0.6, `role-fit ratio was ${roleFit / total}`)
})

test('manual first night writes setup actions and starts on day announcement', () => {
  const room = createRoom(12)
  const setup = createDefaultSetup(room)
  const started = applyInitialSetup(room, setup)
  const seer = findPlayer(started, 'seer')
  const witch = findPlayer(started, 'witch')
  const guard = findPlayer(started, 'guard')

  assert.equal(started.status, 'playing')
  assert.equal(started.currentStep.type, 'day_announcement')
  assert.equal(started.publicFile.sheriff.id, null)
  assert.deepEqual(started.publicFile.sheriff.candidates, setup.sheriffCandidates.map(Number))
  assert.ok(started.queue.some((step) => step.type === 'sheriff_speech'))
  assert.ok(started.queue.some((step) => step.type === 'sheriff_election'))
  assert.equal(started.wolfTeamFile.nightKills.at(-1).source, 'manual')
  assert.equal(started.roleFiles.seer[seer.id].checks.at(-1).source, 'manual')
  assert.equal(started.roleFiles.guard[guard.id].actions.at(-1).source, 'manual')
  assert.equal(started.roleFiles.witch[witch.id].actions.at(-1).source, 'manual')
})

test('local guard decision does not repeat the previous guarded target', async () => {
  const room = createRoom(12)
  const guard = findPlayer(room, 'guard')
  const setup = createDefaultSetup(room)
  setup.guardTarget = guard.id
  let state = applyInitialSetup(room, setup)
  state.day = 2
  state.phase = 'night'
  state.currentStep = { type: 'guard_action', playerId: guard.id }
  state.queue = [state.currentStep]

  assert.equal(state.currentStep?.type, 'guard_action')
  const before = state.roleFiles.guard[guard.id].actions.at(-1).target
  state = await advanceStep(state, { mode: 'local' })
  const after = state.roleFiles.guard[guard.id].actions.at(-1).target
  assert.notEqual(after, before)
})

test('guard current night exposes repeat restriction before recording decision', async () => {
  const room = createRoom(12)
  const guard = findPlayer(room, 'guard')
  const previousTarget = room.players.find((player) => player.id !== guard.id).id
  let state = {
    ...room,
    status: 'playing',
    day: 2,
    phase: 'night',
    currentStep: { type: 'guard_action', playerId: guard.id },
    queue: [{ type: 'guard_action', playerId: guard.id }],
  }
  state.roleFiles.guard[guard.id].actions.push({ night: 1, target: previousTarget, reason: '测试上一晚守护', source: 'manual', result: 'submitted' })

  state = await advanceStep(state, { mode: 'local' })

  const currentNight = state.roleFiles.guard[guard.id].currentNight
  assert.equal(currentNight.previousTarget, previousTarget)
  assert.equal(currentNight.cannotRepeatTarget, previousTarget)
  assert.equal(currentNight.availableTargets.includes(previousTarget), false)
  assert.notEqual(currentNight.decision.target, previousTarget)
})

test('witch current night exposes kill target before action resolution', async () => {
  const room = createRoom(9)
  const witch = findPlayer(room, 'witch')
  const target = room.players.find((player) => player.id !== witch.id).id
  let state = {
    ...room,
    status: 'playing',
    day: 2,
    phase: 'night',
    night: { wolfSuggestions: [], wolfKillTarget: target, guardTarget: null, deaths: [] },
    currentStep: { type: 'witch_action', playerId: witch.id },
    queue: [{ type: 'witch_action', playerId: witch.id }],
  }

  state = await advanceStep(state, { mode: 'local' })

  const currentNight = state.roleFiles.witch[witch.id].currentNight
  assert.equal(currentNight.canSeeKillTarget, true)
  assert.equal(currentNight.killTarget, target)
  assert.equal(currentNight.canSave, true)
  assert.equal(currentNight.availablePoisonTargets.includes(witch.id), false)
  assert.equal(currentNight.decision.action, 'none')
})

test('serial local game can advance repeatedly while resolving sheriff badge decisions', async () => {
  const room = createRoom(9)
  let state = applyInitialSetup(room, createDefaultSetup(room))

  for (let index = 0; index < 90 && state.status !== 'finished'; index += 1) {
    if (state.pendingSheriffElection) {
      state = resolveSheriffElection(state, { target: state.publicFile.sheriff.candidates[0] })
      continue
    }
    if (state.pendingSheriffDecision) {
      const target = alivePlayers(state).find((player) => player.id !== state.pendingSheriffDecision.from)
      state = resolveSheriffBadge(state, target ? { type: 'transfer', target: target.id } : { type: 'destroy' })
      continue
    }
    state = await advanceStep(state, { mode: 'local' })
  }

  assert.ok(state.godView.timeline.length > 10)
  assert.ok(['playing', 'finished'].includes(state.status))
  assert.ok(state.currentStep)
})

test('sheriff campaign speeches pause for user election', async () => {
  const room = createRoom(6)
  const setup = createDefaultSetup(room)
  const safeTarget = room.players.find((player) => !setup.sheriffCandidates.includes(player.id) && player.role !== 'witch') ?? room.players.find((player) => !setup.sheriffCandidates.includes(player.id))
  setup.witchAction = 'none'
  setup.wolfKillTarget = safeTarget?.id ?? setup.sheriffCandidates[0]
  let state = applyInitialSetup(room, setup)

  while (!state.pendingSheriffElection) {
    state = await advanceStep(state, { mode: 'local' })
  }

  const candidateSpeechCount = state.publicFile.speeches.filter((speech) => speech.phase === 'sheriff_speech').length
  assert.equal(candidateSpeechCount, state.publicFile.sheriff.candidates.length)
  assert.equal(state.currentStep.type, 'sheriff_election')

  const selected = state.publicFile.sheriff.candidates[0]
  state = resolveSheriffElection(state, { target: selected })
  assert.equal(state.publicFile.sheriff.id, selected)
  assert.equal(state.pendingSheriffElection, false)
})

test('exiled player gives last words and compresses public summary before night', async () => {
  let state = createRoom(9)
  const target = state.players.find((player) => player.team === 'good')
  state.status = 'playing'
  state.day = 1
  state.phase = 'day'
  state.currentStep = { type: 'exile' }
  state.queue = [{ type: 'exile' }]
  state.publicFile.votes = alivePlayers(state).map((player) => ({ day: 1, voter: player.id, target: target.id, weight: 1, reason: '测试归票' }))

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.currentStep.type, 'exile_speech')
  assert.equal(state.players.find((player) => player.id === target.id).alive, false)

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.phase, 'night')
  assert.equal(state.publicFile.lastWords.at(-1).playerId, target.id)
  assert.ok(state.publicFile.publicEvents.some((event) => event.type === 'exile_speech' && event.playerId === target.id))
  assert.match(state.publicFile.publicSummary.text, /出局发言|放逐记录|近期票型/)
  assert.equal(state.files['public_ai.json'].publicSummary.updatedAt, 'day_1_exile_speech')
  assert.equal(Object.hasOwn(state.files['public_ai.json'], 'publicEvents'), false)
})

test('wolf parity at day announcement ends the game and refreshes files before review', async () => {
  let state = createRoom(6)
  const goodPlayers = state.players.filter((player) => player.team === 'good')
  goodPlayers[0].alive = false
  goodPlayers[0].death = { day: 1, phase: 'day', cause: 'exile', publicReason: '被放逐' }
  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: goodPlayers[1].id, guardTarget: null, deaths: [goodPlayers[1].id] }
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.status, 'finished')
  assert.equal(state.winner, 'wolf')
  assert.equal(state.currentStep.type, 'review')
  assert.equal(state.publicFile.room.status, 'finished')
  assert.equal(state.publicFile.room.winner, 'wolf')
  assert.equal(state.godView.room.winner, 'wolf')
  assert.ok(state.publicFile.publicEvents.some((event) => event.type === 'game_over'))
})

test('wolf kill still resolves when witch is dead before night actions', async () => {
  let state = createRoom(12)
  const witch = findPlayer(state, 'witch')
  const target = state.players.find((player) => player.team === 'good' && !['witch', 'guard', 'hunter'].includes(player.role))

  witch.alive = false
  witch.death = { day: 1, phase: 'day', cause: 'exile', publicReason: '被放逐' }
  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: target.id, guardTarget: null, deaths: [] }
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.players.find((player) => player.id === target.id).alive, false)
  assert.ok(state.publicFile.deaths.at(-1).players.includes(target.id))
  assert.ok(state.publicFile.publicEvents.some((event) => event.content.includes(`昨夜${target.id}号死亡`)))
})

test('12 player guard protects the wolf kill target', async () => {
  let state = createRoom(12)
  const guard = findPlayer(state, 'guard')
  const target = state.players.find((player) => player.team === 'good' && player.id !== guard.id)

  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: target.id, guardTarget: target.id, deaths: [] }
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.players.find((player) => player.id === target.id).alive, true)
  assert.ok(state.publicFile.publicEvents.some((event) => event.content.includes('平安夜')))
})

test('witch can self-save and guard plus witch save still prevents death', async () => {
  let state = createRoom(12)
  const witch = findPlayer(state, 'witch')

  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: witch.id, guardTarget: witch.id, deaths: [] }
  state.roleFiles.witch[witch.id].actions.push({ night: 2, type: 'save', target: witch.id, reason: '测试自救', source: 'manual', result: 'submitted' })
  state.roleFiles.witch[witch.id].hasAntidote = false
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.players.find((player) => player.id === witch.id).alive, true)
  assert.ok(state.publicFile.publicEvents.some((event) => event.content.includes('平安夜')))
})

test('manual first night setup sanitizes invalid targets', () => {
  const room = createRoom(12)
  const seer = findPlayer(room, 'seer')
  const guard = findPlayer(room, 'guard')
  const witch = findPlayer(room, 'witch')
  const wolf = findPlayer(room, 'werewolf')
  const setup = {
    wolfKillTarget: wolf.id,
    seerCheckTarget: seer.id,
    witchAction: 'poison',
    witchPoisonTarget: witch.id,
    guardTarget: 999,
    sheriffCandidates: [999, seer.id, seer.id],
  }

  const state = applyInitialSetup(room, setup)

  assert.equal(state.night.wolfKillTarget, wolf.id)
  assert.notEqual(state.roleFiles.seer[seer.id].checks.at(-1).target, seer.id)
  assert.ok(alivePlayers(state).some((player) => player.id === state.roleFiles.guard[guard.id].actions.at(-1).target))
  assert.notEqual(state.roleFiles.witch[witch.id].actions.at(-1).target, witch.id)
  assert.deepEqual(state.publicFile.sheriff.candidates, [seer.id])
})

test('wolf team can choose a werewolf as the night kill target', async () => {
  let state = createRoom(9)
  const wolf = findPlayer(state, 'werewolf')

  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: wolf.id, guardTarget: null, deaths: [] }
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.players.find((player) => player.id === wolf.id).alive, false)
  assert.ok(state.publicFile.deaths.at(-1).players.includes(wolf.id))
  assert.ok(state.publicFile.publicEvents.some((event) => event.content.includes(`昨夜${wolf.id}号死亡`)))
})

test('public text sanitizer preserves all public text while validators flag leaks', () => {
  const room = createRoom(6)
  const wolf = findPlayer(room, 'werewolf')
  const villager = findPlayer(room, 'villager')
  const witch = findPlayer(room, 'witch')

  const wolfLeak = '4号是我的狼队友，但我投他是为了不暴露团队。'
  const wolfNight = '昨晚我们刀了1号，狼队夜聊已经定好。'
  const witchLeak = '我是3号女巫，昨晚我救了1号，但这不能证明1号一定是好人。'

  assert.equal(sanitizePublicText(wolf, wolfLeak, '安全发言'), wolfLeak)
  assert.equal(sanitizePublicText(wolf, wolfNight, '安全发言'), wolfNight)
  assert.equal(sanitizePublicText(witch, witchLeak, '安全发言', 1, room), witchLeak)
  assert.equal(sanitizePublicText(villager, '昨天我们所有人一起票出5号，今天3号被刀，需要重新看票型。', '安全发言'), '昨天我们所有人一起票出5号，今天3号被刀，需要重新看票型。')
  assert.equal(sanitizePublicText(villager, '我是6号平民，我今晚会继续查验。', '安全发言'), '我是6号平民，我今晚会继续查验。')
  assert.equal(sanitizePublicText(villager, '我是6号预言家，昨晚查验1号，结果是狼人。', '安全发言'), '我是6号预言家，昨晚查验1号，结果是狼人。')
  assert.equal(sanitizePublicText(villager, '3号已经被放逐证实是狼人。', '安全发言'), '3号已经被放逐证实是狼人。')
  assert.ok(validatePublicText(room, wolfLeak).violations.some((item) => item.type === 'hidden_private_leak'))
  assert.ok(validatePublicText(room, wolfNight).violations.some((item) => item.type === 'hidden_private_leak'))
  assert.ok(validatePublicText(room, witchLeak).violations.some((item) => item.type === 'hidden_private_leak'))
  assert.equal(room.godView.debug.publicSanitizations?.length ?? 0, 0)
})

test('public sanitizer preserves hunter exile verification logic while validator flags it', () => {
  const room = createRoom(9)
  const speaker = findPlayer(room, 'villager')
  room.day = 2
  room.phase = 'day'
  room.currentStep = { type: 'day_vote', playerId: speaker.id }

  const text = `${speaker.id}号投3号：出3号验证是否猎人，他的转向太顺。`
  const result = sanitizePublicText(speaker, text, '安全发言', 3, room)

  assert.equal(result, text)
  assert.ok(validatePublicText(room, text).violations.some((item) => item.type === 'hunter_exile_as_verification'))
  assert.equal(room.godView.debug.publicSanitizations?.length ?? 0, 0)
})

test('public sanitizer preserves weak single-axis reasoning while validator flags it', () => {
  const room = createRoom(9)
  const speaker = findPlayer(room, 'villager')
  room.day = 1
  room.phase = 'day'
  room.currentStep = { type: 'day_vote', playerId: speaker.id }

  const text = `${speaker.id}号投5号：只凭后置跳预言家就该出5号，没必要再听。`
  const result = sanitizePublicText(speaker, text, '安全发言', 5, room)

  assert.equal(result, text)
  assert.ok(validatePublicText(room, text).violations.some((item) => item.type === 'weak_single_axis_reasoning'))
  assert.equal(room.godView.debug.publicSanitizations?.length ?? 0, 0)
})

test('seer known wolf check speech is preserved while timing issue is flagged', () => {
  const room = createRoom(9)
  const seer = findPlayer(room, 'seer')
  const wolf = findPlayer(room, 'werewolf')
  room.roleFiles.seer[seer.id].checks.push({ night: 1, target: wolf.id, result: 'wolf', resultLabel: '狼人', source: 'manual' })
  room.day = 1
  room.phase = 'day'
  room.currentStep = { type: 'day_speech', playerId: seer.id }

  const text =
    `${seer.id}号发言：我是${seer.id}号预言家，昨晚查杀${wolf.id}号。平安夜没死人就敢直接甩查杀，这种时机很可疑，但我有真查杀，今天先出${wolf.id}号。`
  const result = sanitizePublicText(
    seer,
    text,
    '安全发言',
    wolf.id,
    room,
  )

  assert.equal(result, text)
  assert.ok(validatePublicText(room, text).violations.some((item) => item.type === 'seer_check_timing_misread'))
  assert.equal(room.godView.debug.publicSanitizations?.length ?? 0, 0)
})

test('public sanitizer preserves repeated template phrases while validator flags them', () => {
  const room = createRoom(9)
  const speaker = findPlayer(room, 'villager')
  room.day = 2
  room.phase = 'day'
  room.currentStep = { type: 'day_speech', playerId: speaker.id }

  const text = `${speaker.id}号发言：3号转向缺少独立依据，行为变形，所以我先打3号。`
  const result = sanitizePublicText(speaker, text, '安全发言', 3, room)

  assert.equal(result, text)
  assert.ok(validatePublicText(room, text).violations.some((item) => item.type === 'overused_template_phrase'))
  assert.equal(room.godView.debug.publicSanitizations?.length ?? 0, 0)
})

test('structured validators report reasoning, style, and fact-boundary issues', () => {
  const room = createRoom(6)
  const speaker = findPlayer(room, 'villager')
  const result = validateDecision(room, speaker, 'day_speech', {
    content: `${speaker.id}号发言：我跟主流，先打3号。`,
    styleMove: '复读',
    claimsMade: [{ type: 'suspicion', targetId: 3, basis: 'death' }],
    focusSuspicion: { target: 3, reason: '大家都在打。' },
    consensusPosition: 'agree_with_new_evidence',
    factCheck: ['我认为3号像狼'],
  })

  assert.equal(result.valid, false)
  assert.ok(result.violations.some((item) => item.type === 'weak_structured_reasoning'))
  assert.ok(result.violations.some((item) => item.type === 'missing_independent_evidence'))
  assert.ok(result.violations.some((item) => item.type === 'missing_fact_boundary_check'))
  assert.ok(result.violations.some((item) => item.type === 'invalid_style_move'))
})

test('context projection separates channels and keeps AI context compact', () => {
  const room = createRoom(9)
  const wolf = findPlayer(room, 'werewolf')
  const villager = findPlayer(room, 'villager')

  room.publicFile.publicEvents = Array.from({ length: 20 }, (_, index) => ({
    day: 1,
    phase: 'day',
    type: 'speech',
    actor: `${index + 1}号`,
    playerId: (index % room.players.length) + 1,
    content: `第${index + 1}条公开发言，内容用于测试投影压缩。`.repeat(10),
  }))
  room.wolfTeamFile.nightChats.push({
    night: 1,
    messages: [{ playerId: wolf.id, content: '狼队私聊内容'.repeat(20), killTarget: villager.id, reason: '测试刀口' }],
  })

  const wolfProjection = buildContextProjection(room, wolf)
  const villagerProjection = buildContextProjection(room, villager)

  assert.ok(wolfProjection.channels.wolf_channel)
  assert.equal(villagerProjection.channels.wolf_channel, null)
  assert.equal(wolfProjection.channels.public_channel.recentEvents.length, 8)
  assert.ok(wolfProjection.channels.public_channel.recentEvents.every((event) => event.content.length <= 420))
  assert.ok(wolfProjection.facts.knownFacts.some((fact) => fact.startsWith('self:')))
  assert.ok(villagerProjection.facts.chainSnapshot.identityChain)
  assert.ok(villagerProjection.facts.chainSnapshot.alignmentChain)
  assert.ok(villagerProjection.facts.chainSnapshot.voteChain)
  assert.equal(wolfProjection.channels[`self_private:${wolf.id}`].identity.role, 'werewolf')
})

test('context projection exposes consensus pressure to reduce bandwagoning', () => {
  const room = createRoom(6)
  const viewer = findPlayer(room, 'villager')
  const target = room.players.find((player) => player.id !== viewer.id)
  const alternate = room.players.find((player) => player.id !== viewer.id && player.id !== target.id)
  room.status = 'playing'
  room.day = 2
  room.phase = 'day'
  room.currentStep = { type: 'day_speech', playerId: viewer.id }
  room.publicFile.speeches.push(
    { day: 2, phase: 'day_speech', playerId: alternate.id, content: `${alternate.id}号发言：我怀疑${target.id}号，他转向太快。` },
    { day: 2, phase: 'day_speech', playerId: target.id, content: `${target.id}号发言：我反过来关注${alternate.id}号。` },
  )
  room.publicFile.votes.push({ day: 2, voter: alternate.id, target: target.id, weight: 1, reason: '测试主流压力' })

  const projection = buildContextProjection(room, viewer)
  const pressure = projection.styleAndMemory.antiBandwagon

  assert.equal(pressure.topTarget, target.id)
  assert.ok(pressure.ranked.some((item) => item.target === target.id && item.score > 1))
  assert.ok(['challenge_or_compare_consensus', 'require_independent_evidence_before_following'].includes(pressure.assignment))
  assert.equal(projection.channels[`self_private:${viewer.id}`].memory.consensusPressure.topTarget, target.id)
})

test('structured validators report hidden leaks, unsupported facts, and illegal targets', () => {
  const room = createRoom(6)
  const actor = findPlayer(room, 'villager')
  const dead = room.players.find((player) => player.id !== actor.id)
  dead.alive = false
  dead.publicRoleRevealed = null
  room.currentStep = { type: 'day_vote', playerId: actor.id }

  const textResult = validatePublicText(room, `昨晚我们刀了2号，${dead.id}号已经坐实狼人。`)
  assert.equal(textResult.valid, false)
  assert.ok(textResult.violations.some((item) => item.type === 'hidden_private_leak'))
  assert.ok(textResult.violations.some((item) => item.type === 'unsupported_public_certainty' || item.type === 'unrevealed_dead_role_as_fact'))

  const decisionResult = validateDecision(room, actor, 'day_vote', { target: dead.id, reason: '测试投死已出局玩家' })
  assert.equal(decisionResult.valid, false)
  assert.ok(decisionResult.violations.some((item) => item.type === 'illegal_target'))
})

test('local public fallback speeches do not reveal private style profile labels', async () => {
  let state = createRoom(6)
  const wolf = findPlayer(state, 'werewolf')
  wolf.persona = { ...wolf.persona, name: '假金水狼' }
  state.status = 'playing'
  state.day = 1
  state.phase = 'day'
  state.currentStep = { type: 'day_speech', playerId: wolf.id }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.publicFile.speeches.at(-1).content.includes('假金水狼'), false)
})

test('local public fallback speeches vary by persona style', async () => {
  let pressureState = createRoom(6)
  const pressure = findPlayer(pressureState, 'villager')
  pressure.persona = { ...pressure.persona, id: 'short_pressure', name: '短句强压型' }
  pressureState.status = 'playing'
  pressureState.day = 1
  pressureState.phase = 'day'
  pressureState.currentStep = { type: 'day_speech', playerId: pressure.id }
  pressureState.queue = [pressureState.currentStep]
  pressureState = await advanceStep(pressureState, { mode: 'local' })

  let calmState = createRoom(6)
  const calm = findPlayer(calmState, 'villager')
  calm.persona = { ...calm.persona, id: 'calm_deconstruct', name: '冷静拆解型' }
  calmState.status = 'playing'
  calmState.day = 1
  calmState.phase = 'day'
  calmState.currentStep = { type: 'day_speech', playerId: calm.id }
  calmState.queue = [calmState.currentStep]
  calmState = await advanceStep(calmState, { mode: 'local' })

  const pressureText = pressureState.publicFile.speeches.at(-1).content
  const calmText = calmState.publicFile.speeches.at(-1).content

  assert.notEqual(pressureText, calmText)
  assert.equal(pressureText.includes('短句强压型'), false)
  assert.equal(calmText.includes('冷静拆解型'), false)
  assert.equal(/先别躲|只问一件事/.test(pressureText), true)
  assert.equal(/拆开看|证据和结论/.test(calmText), true)
})

test('local focus and votes retarget away from dead players after exile', async () => {
  let state = createRoom(6)
  const exiled = state.players.find((player) => player.team === 'good')
  const speaker = state.players.find((player) => player.id !== exiled.id)
  state.status = 'playing'
  state.day = 1
  state.phase = 'day'
  state.currentStep = { type: 'exile' }
  state.queue = [{ type: 'exile' }]
  state.publicFile.votes = alivePlayers(state).map((player) => ({ day: 1, voter: player.id, target: exiled.id, weight: 1, reason: '测试归票' }))

  state = await advanceStep(state, { mode: 'local' })
  state = await advanceStep(state, { mode: 'local' })
  speaker.focusSuspicion = { target: exiled.id, reason: '旧焦点已出局', source: 'test', updatedAt: 'test' }
  state.day = 2
  state.phase = 'day'
  state.currentStep = { type: 'day_vote', playerId: speaker.id }
  state.queue = [{ type: 'day_vote', playerId: speaker.id }]

  state = await advanceStep(state, { mode: 'local' })

  const vote = state.publicFile.votes.at(-1)
  assert.notEqual(vote.target, exiled.id)
  assert.ok(state.players.find((player) => player.id === vote.target)?.alive)
})

test('local votes never self-vote under pressure', async () => {
  let state = createRoom(6)
  const wolf = findPlayer(state, 'werewolf')
  wolf.focusSuspicion = { target: wolf.id, reason: '测试自票压力', source: 'test', updatedAt: 'test' }
  state.status = 'playing'
  state.day = 1
  state.phase = 'day'
  state.currentStep = { type: 'day_vote', playerId: wolf.id }
  state.queue = [{ type: 'day_vote', playerId: wolf.id }]

  state = await advanceStep(state, { mode: 'local' })

  const vote = state.publicFile.votes.at(-1)
  assert.equal(vote.voter, wolf.id)
  assert.notEqual(vote.target, wolf.id)
})

test('local witch uses poison in four-player endgame when poison remains', async () => {
  let state = createRoom(9)
  const witch = findPlayer(state, 'witch')
  const wolf = findPlayer(state, 'werewolf')
  const goodKeep = state.players.filter((player) => player.team === 'good' && player.id !== witch.id).slice(0, 2)
  const aliveKeep = new Set([witch.id, wolf.id, ...goodKeep.map((player) => player.id)])
  for (const player of state.players) {
    player.alive = aliveKeep.has(player.id)
    if (!player.alive) player.death = { day: 2, phase: 'day', cause: 'exile', publicReason: '被放逐' }
  }
  const target = state.players.find((player) => player.alive && player.id !== witch.id)
  witch.focusSuspicion = { target: target.id, reason: '残局最高疑点', source: 'test', updatedAt: 'test' }
  state.roleFiles.witch[witch.id].hasPoison = true
  state.roleFiles.witch[witch.id].hasAntidote = false
  state.status = 'playing'
  state.day = 4
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: null, guardTarget: null, deaths: [] }
  state.currentStep = { type: 'witch_action', playerId: witch.id }
  state.queue = [{ type: 'witch_action', playerId: witch.id }]

  state = await advanceStep(state, { mode: 'local' })

  const action = state.roleFiles.witch[witch.id].actions.at(-1)
  assert.equal(action.type, 'poison')
  assert.equal(action.target, target.id)
})

test('hunter shooting the sheriff creates a badge decision and records public shot', async () => {
  let state = createRoom(9)
  const hunter = findPlayer(state, 'hunter')
  const target = state.players.find((player) => player.id !== hunter.id && player.team === 'good')

  hunter.focusSuspicion = { target: target.id, reason: '测试开枪目标', source: 'manual', updatedAt: 'test' }
  state.publicFile.sheriff.id = target.id
  state.status = 'playing'
  state.day = 2
  state.phase = 'day'

  state = await advanceStep({
    ...state,
    currentStep: { type: 'exile' },
    queue: [{ type: 'exile' }],
    publicFile: {
      ...state.publicFile,
      votes: alivePlayers(state).map((player) => ({ day: 2, voter: player.id, target: hunter.id, weight: 1, reason: '测试' })),
    },
  }, { mode: 'local' })

  assert.equal(state.players.find((player) => player.id === hunter.id).alive, false)
  assert.equal(state.players.find((player) => player.id === target.id).alive, false)
  assert.deepEqual(state.pendingSheriffDecision, { from: target.id })
  assert.ok(state.publicFile.hunterShots.some((shot) => shot.hunterId === hunter.id && shot.target === target.id))
})

test('invalid sheriff badge transfer is destroyed instead of assigning a dead or illegal target', () => {
  let state = createRoom(9)
  const sheriff = state.players[0]
  const deadTarget = state.players[1]
  sheriff.alive = false
  deadTarget.alive = false
  state.publicFile.sheriff.id = sheriff.id
  state.pendingSheriffDecision = { from: sheriff.id }

  state = resolveSheriffBadge(state, { type: 'transfer', target: deadTarget.id })

  assert.equal(state.publicFile.sheriff.id, null)
  assert.equal(state.pendingSheriffDecision, null)
  assert.equal(state.publicFile.sheriff.history.at(-1).type, 'invalid_transfer_destroyed')
})

test('victory resolves before sheriff badge transfer when sheriff death ends the game', async () => {
  let state = createRoom(6)
  const goodPlayers = state.players.filter((player) => player.team === 'good')
  const sheriff = goodPlayers[0]
  const priorDeath = goodPlayers[1]

  priorDeath.alive = false
  priorDeath.death = { day: 1, phase: 'day', cause: 'exile', publicReason: '被放逐' }
  state.publicFile.sheriff.id = sheriff.id
  state.status = 'playing'
  state.day = 2
  state.phase = 'night'
  state.night = { wolfSuggestions: [], wolfKillTarget: sheriff.id, guardTarget: null, deaths: [sheriff.id] }
  state.currentStep = { type: 'day_announcement' }
  state.queue = [state.currentStep]

  state = await advanceStep(state, { mode: 'local' })

  assert.equal(state.status, 'finished')
  assert.equal(state.winner, 'wolf')
  assert.equal(state.pendingSheriffDecision, null)
  assert.equal(state.currentStep.type, 'review')
})

for (const playerCount of [9, 12]) {
  test(`${playerCount} player room advances serially with sheriff decisions and valid file state`, async () => {
    const room = createRoom(playerCount)
    let state = applyInitialSetup(room, createDefaultSetup(room))

    for (let index = 0; index < 180 && state.status !== 'finished'; index += 1) {
      if (state.pendingSheriffElection) {
        state = resolveSheriffElection(state, { target: state.publicFile.sheriff.candidates[0] })
        continue
      }
      if (state.pendingSheriffDecision) {
        const target = alivePlayers(state).find((player) => player.id !== state.pendingSheriffDecision.from)
        state = resolveSheriffBadge(state, target ? { type: 'transfer', target: target.id } : { type: 'destroy' })
        continue
      }
      state = await advanceStep(state, { mode: 'local' })
    }

    assert.equal(state.status, 'finished')
    assert.ok(['wolf', 'good'].includes(state.winner))
    assert.equal(state.publicFile.room.status, 'finished')
    assert.equal(state.publicFile.room.winner, state.winner)
    assert.equal(state.godView.room.winner, state.winner)
    assert.ok(state.publicFile.publicEvents.some((event) => event.type === 'game_over'))
  })
}
