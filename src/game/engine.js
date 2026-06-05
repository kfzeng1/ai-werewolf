import { MODEL_PROVIDERS, callModelDetailed, modelNameForProvider, normalizeProvider, playerModelForProvider } from '../services/modelProvider.js'
import { AUTO_SPEEDS, MODEL_PRICES_PER_MILLION, PERSONA_STYLES, ROLE_LABELS, STEP_LABELS, TEAM_LABELS, WIN_CONDITIONS } from './constants.js'
import { decideExileSpeech, decideGuard, decideHunterShot, decideSeerCheck, decideSheriffSpeech, decideSpeech, decideVote, decideWolfChat, decideWitch, sanitizePublicText, shouldCallModel } from './decisions.js'
import { refreshFiles } from './files.js'
import { ROOM_PRESETS, getRoomRules } from './rooms/index.js'
import { alivePlayers, aliveWolves, clone, createId, fallbackTarget, legalTargetId, legalTargets, normalizeTarget, parseJsonObject, pick, playerById, rolePlayer, roleTeam, shuffle } from './utils.js'

const pickPersona = (role) => {
  const fitted = PERSONA_STYLES.filter((persona) => persona.roleFit?.includes(role))
  if (fitted.length && Math.random() < 0.75) return clone(pick(fitted))
  return clone(pick(PERSONA_STYLES))
}

const createPlayer = (role, index, total, provider = 'deepseek') => {
  return {
    id: index + 1,
    role,
    roleLabel: ROLE_LABELS[role],
    team: roleTeam(role),
    alive: true,
    death: null,
    publicRoleRevealed: null,
    model: playerModelForProvider(provider),
    persona: pickPersona(role),
    focusSuspicion: { target: ((index + 1) % total) + 1, reason: '开局暂无信息，先关注相邻发言位。', source: 'local', updatedAt: 'setup' },
    reasoningState: {
      currentRead: { target: ((index + 1) % total) + 1, stance: 'observe', confidence: 'low', reasons: ['开局暂无独立证据，先观察相邻发言位。'], updatedAt: 'setup' },
      evidenceLedger: [],
      dissentNotes: ['不能因为多数人同向就把公开说法当事实；热门归票必须有自己的独立依据。'],
      antiBandwagon: { requireOwnEvidence: true, avoidReasons: ['大家都这么说', '多数人已投', '我跟票', '票型已经指向'] },
    },
    identityReads: {},
    memory: [],
    strategyNotes: [],
  }
}

const addGodEvent = (room, event) => {
  room.godView.timeline.push({ id: createId(), day: room.day, phase: room.phase, step: room.currentStep?.type ?? 'setup', visibility: event.visibility ?? 'system', type: event.type, actor: event.actor ?? '系统', content: event.content, truth: event.truth ?? null, decision: event.decision ?? null })
}

const addPublicEvent = (room, event) => {
  const entry = { id: createId(), day: room.day, phase: room.phase, ...event }
  room.publicFile.publicEvents.push(entry)
  addGodEvent(room, { ...event, visibility: 'public' })
}

const announce = (room, content) => {
  room.publicFile.announcements.push({ day: room.day, phase: room.phase, content })
  addPublicEvent(room, { type: 'announcement', actor: '主持人', content })
}

const tokenUsageParts = (usage = {}) => {
  const prompt = usage.prompt_tokens ?? 0
  const completion = usage.completion_tokens ?? 0
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const cacheMiss = usage.prompt_cache_miss_tokens ?? Math.max(prompt - cached, 0)
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0
  return { prompt, completion, cached, cacheMiss, reasoning, total: usage.total_tokens ?? prompt + completion }
}

const estimateCostUsd = (model, usage = {}) => {
  const prices = MODEL_PRICES_PER_MILLION[model]
  if (!prices) return 0
  const parts = tokenUsageParts(usage)
  return ((parts.cached * prices.cacheHitInput) + (parts.cacheMiss * prices.cacheMissInput) + (parts.completion * prices.output)) / 1_000_000
}

const recordAiUsage = (room, { model, meta, usage, localCacheHit = false, durationMs = null, finishReason = null, error = null }) => {
  if (!usage && !localCacheHit) return
  const normalizedModel = model ?? meta?.model ?? 'deepseek-v4-flash'
  const parts = tokenUsageParts(usage)
  room.godView.debug.aiCalls.push({
    id: createId(),
    day: room.day,
    step: room.currentStep?.type ?? meta?.step ?? 'unknown',
    kind: meta?.kind ?? 'unknown',
    playerId: meta?.playerId ?? null,
    role: meta?.role ?? null,
    provider: meta?.provider ?? 'deepseek',
    model: normalizedModel,
    localCacheHit,
    durationMs,
    finishReason,
    error,
    usage: parts,
    estimatedUsd: localCacheHit ? 0 : estimateCostUsd(normalizedModel, usage),
  })
}

const buildLocalPublicSummary = (room) => {
  const living = alivePlayers(room).map((player) => `${player.id}号`).join('、') || '无'
  const deaths = room.publicFile.deaths.map((item) => `第${item.day}天${item.announcement}`).slice(-5)
  const exiles = room.publicFile.exiles.map((item) => `第${item.day}天${item.playerId}号被放逐，原因：${item.reason}`).slice(-5)
  const lastWords = room.publicFile.lastWords.map((item) => `${item.playerId}号遗言：${String(item.content).slice(0, 120)}`).slice(-3)
  const recentVotes = room.publicFile.votes.filter((vote) => vote.day >= room.day - 1).map((vote) => `${vote.voter}->${vote.target}`).slice(-room.players.length)
  const publicClaims = (room.publicFile.publicClaims ?? []).slice(-6).map((claim) => `${claim.playerId}号公开说法：${String(claim.content).slice(0, 80)}`)
  const unrevealedDead = room.players.filter((player) => !player.alive && !player.publicRoleRevealed).map((player) => `${player.id}号`).join('、')
  return [
    `当前第${room.day}天，存活：${living}。`,
    deaths.length ? `近几次死亡：${deaths.join('；')}。` : null,
    exiles.length ? `放逐记录：${exiles.join('；')}。` : null,
    lastWords.length ? `近期出局发言：${lastWords.join('；')}。` : null,
    recentVotes.length ? `近期票型：${recentVotes.join('，')}。` : null,
    publicClaims.length ? `近期公开说法：${publicClaims.join('；')}。` : null,
    unrevealedDead ? `未公开身份出局：${unrevealedDead}，只能当作出局事实，不能当作阵营事实。` : null,
  ].filter(Boolean).join('\n').slice(-1200)
}

const updatePublicSummary = async (room, mode, trigger, fallbackText = '') => {
  void mode
  void fallbackText
  const previous = room.publicFile.publicSummary ?? { version: 1, text: '对局刚开始，暂无公共摘要。', keyClaims: [], votePatterns: [], deadPlayers: [], recentEvents: [] }
  const fallback = {
    version: previous.version + 1,
    updatedAt: trigger,
    text: buildLocalPublicSummary(room),
    keyClaims: previous.keyClaims ?? [],
    votePatterns: room.publicFile.exiles.slice(-4).map((item) => `第${item.day}天${item.playerId}号出局：${item.reason}`),
    deadPlayers: room.players.filter((player) => !player.alive).map((player) => ({ id: player.id, day: player.death?.day ?? null, reason: player.death?.publicReason ?? null, revealedRole: player.publicRoleRevealed ?? null })),
    recentEvents: room.publicFile.publicEvents.slice(-6).map((event) => `${event.actor}：${String(event.content).slice(0, 100)}`),
    source: 'local',
  }
  room.publicFile.publicSummary = fallback
  return fallback
}

const createRoom = (playerCount = 9, provider = 'deepseek') => {
  const rules = getRoomRules(playerCount)
  const roles = shuffle(rules.roles)
  const selectedProvider = normalizeProvider(provider)
  const players = roles.map((role, index) => createPlayer(role, index, roles.length, selectedProvider))
  const wolves = players.filter((player) => player.role === 'werewolf').map((player) => player.id)
  const room = {
    id: createId(), preset: rules.label, playerCount: rules.playerCount, modelProvider: selectedProvider, day: 1, phase: 'preparation', status: 'preparing', winner: null, players, currentStep: null, queue: [],
    night: { wolfSuggestions: [], wolfKillTarget: null, guardTarget: null, deaths: [] },
    publicFile: { sheriff: { enabled: true, id: null, voteWeight: 1.5, candidates: [], history: [] }, announcements: [], speeches: [], votes: [], deaths: [], exiles: [], hunterShots: [], publicClaims: [], publicEvents: [] },
    wolfTeamFile: { team: 'wolf', wolves, aliveWolves: wolves, deadWolves: [], winCondition: WIN_CONDITIONS.werewolf, teamStrategy: ['隐藏身份', '必要时悍跳预言家', '避免明显互保'], nightChats: [], nightKills: [] },
    hostFile: { role: 'host', model: playerModelForProvider(selectedProvider), style: '冷静、简洁、有仪式感', reviewPolicy: { onlyCallAtGameEnd: true, canUseGodView: true, canRevealAllRoles: true } },
    godView: { room: {}, players: [], timeline: [], debug: { aiCalls: [] } },
    roleFiles: { seer: {}, witch: {}, guard: {}, hunter: {} }, files: {}, pendingSheriffElection: false, pendingSheriffDecision: null, review: '',
  }
  for (const player of players) {
    if (player.role === 'seer') room.roleFiles.seer[player.id] = { playerId: player.id, role: 'seer', checks: [] }
    if (player.role === 'witch') room.roleFiles.witch[player.id] = { playerId: player.id, role: 'witch', hasAntidote: true, hasPoison: true, currentNight: null, actions: [] }
    if (player.role === 'guard') room.roleFiles.guard[player.id] = { playerId: player.id, role: 'guard', currentNight: null, actions: [] }
    if (player.role === 'hunter') room.roleFiles.hunter[player.id] = { playerId: player.id, role: 'hunter', hasBullet: true, canShootOnDeath: { night_death: true, exile: true, poison: false, hunter_shot: false }, currentDeath: null, shots: [] }
  }
  addGodEvent(room, { visibility: 'system', type: 'setup', actor: '系统', content: `${rules.label}已创建，身份与发言风格已分配。` })
  return refreshFiles(room)
}

const createDefaultSetup = (room) => {
  const seer = room.players.find((player) => player.role === 'seer')
  const witch = room.players.find((player) => player.role === 'witch')
  const guard = room.players.find((player) => player.role === 'guard')
  const candidates = shuffle(room.players).slice(0, Math.max(2, Math.ceil(room.players.length / 3))).map((player) => player.id)
  return { wolfKillTarget: pick(room.players)?.id ?? room.players[0].id, seerCheckTarget: room.players.find((player) => player.id !== seer?.id)?.id ?? room.players[0].id, witchAction: 'none', witchPoisonTarget: room.players.find((player) => player.id !== witch?.id)?.id ?? null, guardTarget: guard ? room.players.find((player) => player.id !== guard.id)?.id ?? guard.id : null, sheriffCandidates: candidates }
}

const updateGuardCurrentNight = (room, guard, decision = null) => {
  const guardFile = room.roleFiles.guard[guard.id]
  const previousTarget = guardFile?.actions?.[guardFile.actions.length - 1]?.target ?? null
  const excluded = [previousTarget].filter(Boolean)
  guardFile.currentNight = {
    night: room.day,
    previousTarget,
    cannotRepeatTarget: previousTarget,
    availableTargets: legalTargets(room, { exclude: excluded }).map((player) => player.id),
    decision,
  }
  return guardFile.currentNight
}
const updateWitchCurrentNight = (room, witch, decision = null) => {
  const file = room.roleFiles.witch[witch.id]
  file.currentNight = {
    night: room.day,
    canSeeKillTarget: file.hasAntidote,
    killTarget: file.hasAntidote ? room.night.wolfKillTarget : null,
    canSave: file.hasAntidote && Boolean(room.night.wolfKillTarget),
    canPoison: file.hasPoison,
    availablePoisonTargets: file.hasPoison ? legalTargets(room, { exclude: [witch.id] }).map((player) => player.id) : [],
    decision,
  }
  return file.currentNight
}
const updateFocus = (room, player, focus, source, updatedAt) => {
  const fallback = normalizeTarget(room, player.focusSuspicion.target, null, { exclude: [player.id] }) ?? legalTargets(room, { exclude: [player.id] })[0]?.id ?? null
  const target = normalizeTarget(room, focus?.target, fallback, { exclude: [player.id] })
  player.focusSuspicion = { target, reason: focus?.reason ?? `继续关注${target}号。`, source, updatedAt }
}

const updateReasoningState = (player, { day, target, reason, evidence, stance = 'suspect', confidence = 'medium', updatedAt }) => {
  if (!player.reasoningState) {
    player.reasoningState = {
      currentRead: null,
      evidenceLedger: [],
      dissentNotes: [],
      antiBandwagon: { requireOwnEvidence: true, avoidReasons: ['大家都这么说', '多数人已投', '我跟票', '票型已经指向'] },
    }
  }
  const cleanReason = String(reason || `继续观察${target ?? '焦点位'}。`).slice(0, 120)
  player.reasoningState.currentRead = {
    target: target ?? null,
    stance,
    confidence,
    reasons: [cleanReason],
    updatedAt,
  }
  player.reasoningState.evidenceLedger.push({
    day,
    target: target ?? null,
    source: updatedAt,
    evidence: String(evidence || cleanReason).slice(0, 140),
  })
  player.reasoningState.evidenceLedger = player.reasoningState.evidenceLedger.slice(-6)
  if (target) {
    player.identityReads ??= {}
    const previous = player.identityReads[target] ?? {}
    const isWolf = player.role === 'werewolf'
    player.identityReads[target] = {
      playerId: target,
      alignment: isWolf ? 'known_good_target' : stance === 'observe' ? 'unknown' : 'suspected_wolf',
      role: previous.role ?? 'unknown',
      roleConfidence: previous.roleConfidence ?? 'low',
      threatLevel: isWolf ? stance === 'night_target' ? 'high' : 'medium' : previous.threatLevel ?? 'unknown',
      actionPriority: isWolf ? stance === 'night_target' ? 'night_kill_candidate' : 'power_role_or_mislynch_candidate' : stance === 'vote' ? 'vote_pressure' : 'observe',
      confidence,
      reason: cleanReason,
      updatedAt,
    }
  }
}

const witchActionForNight = (room, night = room.day) => Object.values(room.roleFiles.witch)
  .flatMap((file) => file.actions ?? [])
  .reverse()
  .find((action) => action.night === night)

const resolveNightDeaths = (room) => {
  const deaths = new Set()
  if (room.night.wolfKillTarget) deaths.add(room.night.wolfKillTarget)
  if (room.night.guardTarget && room.night.guardTarget === room.night.wolfKillTarget) deaths.delete(room.night.wolfKillTarget)

  const witchAction = witchActionForNight(room)
  if (witchAction?.type === 'save' && witchAction.target === room.night.wolfKillTarget) deaths.delete(room.night.wolfKillTarget)
  if (witchAction?.type === 'poison' && witchAction.target) deaths.add(witchAction.target)

  return [...deaths].filter(Boolean)
}

const writeDeath = async (room, id, cause, publicReason, mode) => {
  const player = playerById(room, id)
  if (!player || !player.alive) return []
  player.alive = false
  player.death = { day: room.day, phase: room.phase, cause, publicReason }
  const deaths = [id]
  if (player.id === room.publicFile.sheriff.id) room.pendingSheriffDecision = { from: player.id }
  if (player.role === 'hunter') {
    const hunterFile = room.roleFiles.hunter[player.id]
    const canShoot = hunterFile?.hasBullet && hunterFile.canShootOnDeath[cause]
    hunterFile.currentDeath = { cause, canShoot, availableTargets: alivePlayers(room).filter((target) => target.id !== player.id).map((target) => target.id) }
    if (canShoot) {
      const decision = await decideHunterShot(room, player, mode)
      const target = decision.target
      hunterFile.hasBullet = false
      hunterFile.shots.push({ day: room.day, cause, target, reason: decision.reason, source: decision.source, result: 'submitted' })
      const shotTarget = playerById(room, target)
      if (shotTarget?.alive) {
        player.publicRoleRevealed = 'hunter'
        shotTarget.alive = false
        shotTarget.death = { day: room.day, phase: room.phase, cause: 'hunter_shot', publicReason: '被猎人开枪带走' }
        if (shotTarget.id === room.publicFile.sheriff.id) room.pendingSheriffDecision = { from: shotTarget.id }
        deaths.push(shotTarget.id)
        room.publicFile.hunterShots.push({ day: room.day, phase: room.phase, hunterId: player.id, target: shotTarget.id, content: `${player.id}号猎人死亡后开枪，带走${shotTarget.id}号。` })
        addPublicEvent(room, { type: 'hunter_shot', actor: `${player.id}号猎人`, target: shotTarget.id, content: `${player.id}号猎人死亡后开枪，带走${shotTarget.id}号。` })
      }
    }
  }
  return deaths
}

const applyInitialSetup = (inputRoom, setup) => {
  const room = clone(inputRoom)
  const seer = rolePlayer(room, 'seer')
  const guard = rolePlayer(room, 'guard')
  const witch = rolePlayer(room, 'witch')
  const sheriffCandidates = [...new Set((setup.sheriffCandidates ?? []).map(Number))]
    .filter((id) => legalTargetId(room, id))
  const wolfKillTarget = fallbackTarget(room, setup.wolfKillTarget)
  const seerCheckTarget = seer ? fallbackTarget(room, setup.seerCheckTarget, { exclude: [seer.id] }) : null
  const guardTarget = guard ? fallbackTarget(room, setup.guardTarget) : null
  const witchPoisonTarget = witch ? fallbackTarget(room, setup.witchPoisonTarget, { exclude: [witch.id] }) : null
  room.phase = 'night'
  room.status = 'playing'
  room.currentStep = { type: 'manual_setup' }
  room.publicFile.sheriff.candidates = sheriffCandidates.length ? sheriffCandidates : [alivePlayers(room)[0]?.id].filter(Boolean)
  room.publicFile.sheriff.id = null
  room.publicFile.sheriff.history.push({ day: 1, type: 'candidates_set', candidates: room.publicFile.sheriff.candidates })
  addPublicEvent(room, { type: 'sheriff_candidates', actor: '主持人', content: `开局设置：${room.publicFile.sheriff.candidates.join('、')}号参与警长竞选。`, candidates: room.publicFile.sheriff.candidates })

  room.night.wolfKillTarget = wolfKillTarget
  room.wolfTeamFile.nightKills.push({ night: 1, target: room.night.wolfKillTarget, reason: '用户开局设置', source: 'manual', result: 'submitted' })
  addGodEvent(room, { visibility: 'private', type: 'wolf_kill', actor: '狼队', content: `用户设置首夜狼刀${room.night.wolfKillTarget}号。`, decision: { source: 'manual' } })

  if (seer && seerCheckTarget) {
    const target = seerCheckTarget
    const targetPlayer = playerById(room, target)
    const check = { night: 1, target, reason: '用户开局设置', result: targetPlayer?.role === 'werewolf' ? 'wolf' : 'not_wolf', resultLabel: targetPlayer?.role === 'werewolf' ? '狼人' : '不是狼人', source: 'manual' }
    room.roleFiles.seer[seer.id].checks.push(check)
    addGodEvent(room, { visibility: 'private', type: 'seer_check', actor: `${seer.id}号预言家`, content: `${seer.id}号查验${target}号，结果：${check.resultLabel}。`, truth: { target, targetRole: targetPlayer?.role, result: check.result }, decision: { source: 'manual' } })
  }

	  if (guard && guardTarget) {
	    const decision = { night: 1, target: guardTarget, reason: '用户开局设置', source: 'manual', result: 'submitted' }
	    room.roleFiles.guard[guard.id].currentNight = { night: 1, previousTarget: null, cannotRepeatTarget: null, availableTargets: legalTargets(room).map((player) => player.id), decision }
	    room.roleFiles.guard[guard.id].actions.push(decision)
	    room.night.guardTarget = decision.target
	    addGodEvent(room, { visibility: 'private', type: 'guard_action', actor: `${guard.id}号守卫`, content: `${guard.id}号守护${decision.target}号。`, decision })
  }

	  if (witch) {
	    const file = room.roleFiles.witch[witch.id]
	    updateWitchCurrentNight(room, witch)
	    const action = setup.witchAction === 'save' && file.hasAntidote && room.night.wolfKillTarget ? 'save' : setup.witchAction === 'poison' && file.hasPoison && witchPoisonTarget ? 'poison' : 'none'
	    const decision = { night: 1, type: action, target: action === 'save' ? room.night.wolfKillTarget : action === 'poison' ? witchPoisonTarget : null, reason: '用户开局设置', source: 'manual', result: 'submitted' }
	    updateWitchCurrentNight(room, witch, decision)
	    file.actions.push(decision)
    if (action === 'save') file.hasAntidote = false
    if (action === 'poison') file.hasPoison = false
    addGodEvent(room, { visibility: 'private', type: 'witch_action', actor: `${witch.id}号女巫`, content: `${witch.id}号女巫首夜行动：${action === 'save' ? `救${room.night.wolfKillTarget}号` : action === 'poison' ? `毒${decision.target}号` : '不用药'}。`, decision })
  }

  room.night.deaths = resolveNightDeaths(room)
  const sheriffSpeakers = room.publicFile.sheriff.candidates.filter((id) => playerById(room, id)?.alive)
  room.queue = [{ type: 'day_announcement' }, ...sheriffSpeakers.map((playerId) => ({ type: 'sheriff_speech', playerId })), { type: 'sheriff_election' }, ...alivePlayers(room).map((player) => ({ type: 'day_speech', playerId: player.id })), ...alivePlayers(room).map((player) => ({ type: 'day_vote', playerId: player.id })), { type: 'exile' }]
  room.currentStep = room.queue[0]
  return refreshFiles(room)
}

const buildNightQueue = (room) => {
  const steps = []
  const rules = getRoomRules(room.playerCount ?? room.players.length)
  for (const type of rules.nightOrder) {
    if (type === 'wolf_chat') {
      for (const wolf of aliveWolves(room)) steps.push({ type, playerId: wolf.id })
      continue
    }
    if (type === 'seer_check') {
      const seer = rolePlayer(room, 'seer')
      if (seer) steps.push({ type, playerId: seer.id })
      continue
    }
    if (type === 'guard_action') {
      const guard = rolePlayer(room, 'guard')
      if (guard) steps.push({ type, playerId: guard.id })
      continue
    }
    if (type === 'witch_action') {
      const witch = rolePlayer(room, 'witch')
      if (witch) steps.push({ type, playerId: witch.id })
      continue
    }
    steps.push({ type })
  }
  return steps
}
const checkWinner = (room) => {
  const wolves = room.players.filter((player) => player.alive && player.team === 'wolf').length
  const good = room.players.filter((player) => player.alive && player.team === 'good').length
  if (wolves === 0) return 'good'
  if (wolves >= good) return 'wolf'
  return null
}
const hasPendingExileSpeech = (room) => room.queue?.some((step) => step.type === 'exile_speech')

const buildHostReviewFacts = (room, winner) => ({
  result: { winner, winnerLabel: TEAM_LABELS[winner], endedAtDay: room.day, playerCount: room.players.length, preset: room.preset },
  players: room.players.map((player) => ({
    id: player.id,
    role: player.role,
    roleLabel: player.roleLabel,
    team: player.team,
    alive: player.alive,
    death: player.death,
    publicRoleRevealed: player.publicRoleRevealed,
  })),
  public: {
    sheriff: room.publicFile.sheriff,
    deaths: room.publicFile.deaths,
    exiles: room.publicFile.exiles,
    hunterShots: room.publicFile.hunterShots,
    lastWords: room.publicFile.lastWords,
    votes: room.publicFile.votes,
    summary: room.publicFile.publicSummary,
  },
  roles: {
    seerChecks: Object.values(room.roleFiles.seer).flatMap((file) => file.checks ?? []),
    witchActions: Object.values(room.roleFiles.witch).flatMap((file) => file.actions ?? []),
    guardActions: Object.values(room.roleFiles.guard).flatMap((file) => file.actions ?? []),
    hunterShots: Object.values(room.roleFiles.hunter).flatMap((file) => file.shots ?? []),
  },
  wolves: {
    members: room.wolfTeamFile.wolves,
    nightKills: room.wolfTeamFile.nightKills,
    nightChats: room.wolfTeamFile.nightChats,
  },
  timeline: room.godView.timeline.map((event) => ({
    day: event.day,
    phase: event.phase,
    step: event.step,
    type: event.type,
    actor: event.actor,
    content: event.content,
    truth: event.truth,
  })),
})

const buildFallbackReview = (room, winner, facts = buildHostReviewFacts(room, winner)) => {
  const deadPlayers = facts.players.filter((player) => !player.alive)
  const wolfPlayers = facts.players.filter((player) => player.team === 'wolf')
  const goodPlayers = facts.players.filter((player) => player.team === 'good')
  const exiles = facts.public.exiles.map((item) => `第${item.day}天${item.playerId}号被放逐，原因：${item.reason}。`).slice(-6)
  const deaths = facts.public.deaths.map((item) => item.announcement).slice(-6)
  const checks = facts.roles.seerChecks.map((check) => `预言家第${check.night}夜查验${check.target}号为${check.resultLabel}。`).slice(-6)
  const wolfKills = facts.wolves.nightKills.map((kill) => `狼队第${kill.night}夜刀口为${kill.target}号。`).slice(-6)

  return {
    title: `${TEAM_LABELS[winner]}胜利复盘`,
    result: `${TEAM_LABELS[winner]}胜利`,
    summary: `${room.preset}在第${room.day}天结束。狼队为${wolfPlayers.map((player) => `${player.id}号${player.roleLabel}`).join('、')}；好人阵营为${goodPlayers.map((player) => `${player.id}号${player.roleLabel}`).join('、')}。最终${TEAM_LABELS[winner]}达成胜利条件。`,
    turningPoints: [...deaths, ...exiles, ...checks, ...wolfKills].slice(-6),
    goodSide: [
      checks.length ? `预言家信息：${checks.join('')}` : '预言家没有形成足够公开的查验信息。',
      facts.roles.witchActions.length ? `女巫行动：${facts.roles.witchActions.map((action) => `第${action.night}夜${action.type}${action.target ? `${action.target}号` : ''}`).join('；')}。` : '女巫没有留下关键用药记录。',
      facts.roles.guardActions.length ? `守卫行动：${facts.roles.guardActions.map((action) => `第${action.night}夜守${action.target}号`).join('；')}。` : '本局没有守卫关键记录或无守卫。',
    ],
    wolfSide: [
      `狼队成员：${wolfPlayers.map((player) => `${player.id}号`).join('、')}。`,
      wolfKills.length ? `夜间刀口：${wolfKills.join('')}` : '狼队夜间刀口记录较少。',
      facts.wolves.nightChats.length ? '狼队夜聊已记录在上帝视角中，复盘应重点看刀口选择与白天票型是否配合。' : '狼队夜聊信息不足。',
    ],
    keyMistakes: deadPlayers.slice(-4).map((player) => `${player.id}号${player.roleLabel}在第${player.death?.day ?? '?'}天因${player.death?.publicReason ?? '未知原因'}出局。`),
    hostNotes: ['这是基于引擎真实文件生成的结构化复盘，包含隐藏身份与上帝视角。'],
  }
}

const normalizeReview = (raw, fallback) => {
  const parsed = parseJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') return fallback
  const list = (value, fallbackValue = []) => Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 8) : fallbackValue
  return {
    title: String(parsed.title || fallback.title),
    result: String(parsed.result || fallback.result),
    summary: String(parsed.summary || fallback.summary),
    turningPoints: list(parsed.turningPoints, fallback.turningPoints),
    goodSide: list(parsed.goodSide, fallback.goodSide),
    wolfSide: list(parsed.wolfSide, fallback.wolfSide),
    keyMistakes: list(parsed.keyMistakes, fallback.keyMistakes),
    hostNotes: list(parsed.hostNotes, fallback.hostNotes),
  }
}

const finishIfNeeded = async (room, mode) => {
  const winner = checkWinner(room)
  if (!winner) return false
  room.status = 'finished'
  room.winner = winner
  room.pendingSheriffElection = false
  room.pendingSheriffDecision = null
  room.currentStep = { type: 'review' }
  const facts = buildHostReviewFacts(room, winner)
  const fallbackReview = buildFallbackReview(room, winner, facts)
  addPublicEvent(room, { type: 'game_over', actor: '主持人', content: `${TEAM_LABELS[winner]}胜利。` })
  refreshFiles(room)
  const provider = normalizeProvider(mode)
  if (shouldCallModel(mode)) {
    try {
      const meta = { kind: 'host_review', provider, day: room.day, step: 'review' }
      const result = await callModelDetailed({
        provider,
        model: modelNameForProvider(provider),
        thinking: 'disabled',
        temperature: 0.45,
        meta,
        messages: [
          {
            role: 'system',
            content: [
              `你是狼人杀主持人，游戏已经结束，胜利方是${TEAM_LABELS[winner]}。`,
              '你可以读取上帝视角事实包，包含所有玩家身份、关键公共记录、角色技能记录、狼队刀口和时间线。必须深度复盘真实发生的事件。',
              '只输出JSON，不要Markdown。格式：{"title":"...","result":"...","summary":"...","turningPoints":["..."],"goodSide":["..."],"wolfSide":["..."],"keyMistakes":["..."],"hostNotes":["..."]}',
              '每个数组 3-6 条，内容要具体到玩家号、天数和事件。不得编造事实，不要说游戏尚未结束。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify(facts),
          },
        ],
      })
      room.review = JSON.stringify(normalizeReview(result.content, fallbackReview))
      recordAiUsage(room, { model: result.model ?? modelNameForProvider(provider), meta, usage: result.usage, localCacheHit: result.localCacheHit })
    } catch { room.review = JSON.stringify(fallbackReview) }
  } else room.review = JSON.stringify(fallbackReview)
  return true
}

const advanceStep = async (inputRoom, { mode = 'local' } = {}) => {
  const room = clone(inputRoom)
  room.modelProvider = normalizeProvider(mode)
  room.hostFile.model = playerModelForProvider(room.modelProvider)
  for (const player of room.players) player.model = playerModelForProvider(room.modelProvider)
  if (room.status === 'finished' || room.pendingSheriffElection || room.pendingSheriffDecision) return refreshFiles(room)
  if (!hasPendingExileSpeech(room) && await finishIfNeeded(room, mode)) return refreshFiles(room)
  room.currentStep = room.queue[0]
  const step = room.currentStep
  if (!step) {
    if (await finishIfNeeded(room, mode)) return refreshFiles(room)
    room.queue = [...alivePlayers(room).map((player) => ({ type: 'day_speech', playerId: player.id })), ...alivePlayers(room).map((player) => ({ type: 'day_vote', playerId: player.id })), { type: 'exile' }]
    room.currentStep = room.queue[0]
    return refreshFiles(room)
  }
  room.queue.shift()

  if (step.type === 'day_announcement') {
    room.phase = 'day'
    room.night.deaths = resolveNightDeaths(room)
    const allDeaths = []
    const witchAction = witchActionForNight(room)
    const poisonTarget = witchAction?.type === 'poison' ? witchAction.target : null
    for (const id of room.night.deaths) allDeaths.push(...await writeDeath(room, id, Number(id) === Number(poisonTarget) ? 'poison' : 'night_death', '昨夜死亡', mode))
    const unique = [...new Set(allDeaths)]
    if (unique.length) {
      room.publicFile.deaths.push({ day: room.day, phase: 'day_announcement', players: unique, announcement: `昨夜${unique.join('、')}号死亡。` })
      announce(room, `天亮了，昨夜${unique.join('、')}号死亡。`)
    } else announce(room, '天亮了，昨晚是平安夜。')
    await updatePublicSummary(room, 'local', `day_${room.day}_announcement`)
  }

  if (step.type === 'day_speech') {
    const player = playerById(room, step.playerId)
    if (player?.alive) {
      const decision = await decideSpeech(room, player, mode)
      updateFocus(room, player, decision.focusSuspicion, decision.source, `day_${room.day}_speech`)
      updateReasoningState(player, { day: room.day, target: player.focusSuspicion.target, reason: player.focusSuspicion.reason, evidence: decision.content, updatedAt: `day_${room.day}_speech` })
      const speech = { day: room.day, phase: 'day_speech', playerId: player.id, content: decision.content }
      room.publicFile.speeches.push(speech)
      player.memory.push(`公开发言：${decision.content}`)
      addPublicEvent(room, { type: 'speech', actor: `${player.id}号`, playerId: player.id, content: decision.content })
    }
  }

  if (step.type === 'sheriff_speech') {
    const player = playerById(room, step.playerId)
    if (player?.alive) {
      const decision = await decideSheriffSpeech(room, player, mode)
      updateFocus(room, player, decision.focusSuspicion, decision.source, `day_${room.day}_sheriff_speech`)
      updateReasoningState(player, { day: room.day, target: player.focusSuspicion.target, reason: player.focusSuspicion.reason, evidence: decision.content, updatedAt: `day_${room.day}_sheriff_speech` })
      const speech = { day: room.day, phase: 'sheriff_speech', playerId: player.id, content: decision.content }
      room.publicFile.speeches.push(speech)
      player.memory.push(`警上发言：${decision.content}`)
      addPublicEvent(room, { type: 'sheriff_speech', actor: `${player.id}号`, playerId: player.id, content: decision.content })
    }
  }

  if (step.type === 'sheriff_election') {
    room.pendingSheriffElection = true
    addGodEvent(room, { visibility: 'system', type: 'sheriff_election_waiting', actor: '系统', content: '警长竞选发言结束，等待用户选择警长。' })
  }

  if (step.type === 'day_vote') {
    const player = playerById(room, step.playerId)
    if (player?.alive) {
      const decision = await decideVote(room, player, mode)
      updateReasoningState(player, { day: room.day, target: decision.target, reason: decision.reason, evidence: `投票理由：${decision.reason}`, stance: 'vote', updatedAt: `day_${room.day}_vote` })
      const vote = { day: room.day, voter: player.id, target: decision.target, weight: player.id === room.publicFile.sheriff.id ? room.publicFile.sheriff.voteWeight : 1, reason: decision.reason }
      room.publicFile.votes.push(vote)
      addPublicEvent(room, { type: 'vote', actor: `${player.id}号`, content: `${player.id}号投给${decision.target}号：${decision.reason}`, vote })
    }
  }

  if (step.type === 'exile') {
    const votes = room.publicFile.votes.filter((vote) => vote.day === room.day)
    const counts = votes.reduce((acc, vote) => ({ ...acc, [vote.target]: (acc[vote.target] ?? 0) + vote.weight }), {})
    const voteCounts = Object.values(counts)
    const max = voteCounts.length ? Math.max(...voteCounts) : 0
    const tied = Object.entries(counts).filter(([, value]) => value === max).map(([id]) => Number(id))
    const selected = pick(tied) ?? pick(alivePlayers(room))?.id
    if (!selected) {
      room.queue.shift()
      room.currentStep = room.queue[0]
      return refreshFiles(room)
    }
    room.publicFile.exiles.push({ day: room.day, playerId: selected, voteCount: max, reason: tied.length > 1 ? '平票随机' : '公开投票最高', tied })
    addPublicEvent(room, { type: 'exile', actor: '主持人', content: tied.length > 1 ? `平票：${tied.join('、')}号，随机放逐${selected}号。` : `${selected}号被放逐出局。` })
    await writeDeath(room, selected, 'exile', '被放逐', mode)
    room.queue.unshift({ type: 'exile_speech', playerId: selected })
  }

  if (step.type === 'exile_speech') {
    const player = playerById(room, step.playerId)
    if (player && !player.alive) {
      const decision = await decideExileSpeech(room, player, mode)
      updateFocus(room, player, decision.focusSuspicion, decision.source, `day_${room.day}_exile_speech`)
      updateReasoningState(player, { day: room.day, target: player.focusSuspicion.target, reason: player.focusSuspicion.reason, evidence: decision.content, updatedAt: `day_${room.day}_exile_speech` })
      const lastWord = { day: room.day, phase: 'exile_speech', playerId: player.id, content: decision.content, source: decision.source }
      room.publicFile.lastWords.push(lastWord)
      room.publicFile.speeches.push(lastWord)
      player.memory.push(`出局发言：${decision.content}`)
      addPublicEvent(room, { type: 'exile_speech', actor: `${player.id}号`, playerId: player.id, content: decision.content })
      await updatePublicSummary(room, mode, `day_${room.day}_exile_speech`, decision.content)
    }
    room.day += 1
    room.phase = 'night'
    room.night = { wolfSuggestions: [], wolfKillTarget: null, guardTarget: null, deaths: [] }
    room.queue = buildNightQueue(room)
  }

  if (step.type === 'wolf_chat') {
    room.phase = 'night'
    const wolf = playerById(room, step.playerId)
    if (wolf?.alive) {
      const decision = await decideWolfChat(room, wolf, mode)
      updateReasoningState(wolf, { day: room.day, target: decision.killTarget, reason: decision.reason, evidence: decision.content, stance: 'night_target', confidence: 'medium', updatedAt: `night_${room.day}_wolf_chat` })
      room.night.wolfSuggestions.push({ playerId: wolf.id, killTarget: decision.killTarget, reason: decision.reason, content: decision.content, source: decision.source })
      let chat = room.wolfTeamFile.nightChats.find((item) => item.night === room.day)
      if (!chat) { chat = { night: room.day, messages: [] }; room.wolfTeamFile.nightChats.push(chat) }
      chat.messages.push({ playerId: wolf.id, content: decision.content, killTarget: decision.killTarget, reason: decision.reason, source: decision.source })
      addGodEvent(room, { visibility: 'private', type: 'wolf_chat', actor: `${wolf.id}号狼人`, content: `${decision.content} 建议刀${decision.killTarget}号。`, decision })
    }
  }

  if (step.type === 'wolf_kill_resolve') {
    const counts = room.night.wolfSuggestions.reduce((acc, item) => ({ ...acc, [item.killTarget]: (acc[item.killTarget] ?? 0) + 1 }), {})
    const suggestionCounts = Object.values(counts)
    const max = suggestionCounts.length ? Math.max(...suggestionCounts) : 0
    const tied = Object.entries(counts).filter(([, value]) => value === max).map(([id]) => Number(id))
    const target = pick(tied) ?? pick(legalTargets(room))?.id
    room.night.wolfKillTarget = target
    room.wolfTeamFile.nightKills.push({ night: room.day, target, reason: tied.length > 1 ? '狼队建议平票，随机选择' : '狼队建议多数目标', source: 'system', result: 'submitted', tied })
    addGodEvent(room, { visibility: 'private', type: 'wolf_kill', actor: '狼队', content: `狼队最终刀口：${target}号。`, truth: { target }, decision: { source: 'system', tied } })
  }

  if (step.type === 'seer_check') {
    const seer = playerById(room, step.playerId)
    if (seer?.alive) {
      const decision = await decideSeerCheck(room, seer, mode)
      const target = playerById(room, decision.target)
      if (!target) {
        addGodEvent(room, { visibility: 'private', type: 'seer_check_skipped', actor: `${seer.id}号预言家`, content: `${seer.id}号没有可查验目标。`, decision })
      } else {
        const check = { night: room.day, target: decision.target, reason: decision.reason, result: target.role === 'werewolf' ? 'wolf' : 'not_wolf', resultLabel: target.role === 'werewolf' ? '狼人' : '不是狼人', source: decision.source }
        room.roleFiles.seer[seer.id].checks.push(check)
        addGodEvent(room, { visibility: 'private', type: 'seer_check', actor: `${seer.id}号预言家`, content: `${seer.id}号查验${target.id}号，结果：${check.resultLabel}。`, truth: { target: target.id, targetRole: target.role, result: check.result }, decision })
      }
    }
  }

	  if (step.type === 'guard_action') {
	    const guard = playerById(room, step.playerId)
	    if (guard?.alive) {
	      updateGuardCurrentNight(room, guard)
	      const decision = await decideGuard(room, guard, mode)
	      room.night.guardTarget = decision.target
	      updateGuardCurrentNight(room, guard, decision)
	      room.roleFiles.guard[guard.id].actions.push({ night: room.day, target: decision.target, reason: decision.reason, source: decision.source, result: 'submitted' })
	      addGodEvent(room, { visibility: 'private', type: 'guard_action', actor: `${guard.id}号守卫`, content: `${guard.id}号守护${decision.target}号。`, decision })
	    }
	  }

	  if (step.type === 'witch_action') {
	    const witch = playerById(room, step.playerId)
	    if (witch?.alive) {
	      updateWitchCurrentNight(room, witch)
	      const decision = await decideWitch(room, witch, mode)
	      const file = room.roleFiles.witch[witch.id]
	      updateWitchCurrentNight(room, witch, decision)
	      const type = decision.action === 'save' && file.hasAntidote ? 'save' : decision.action === 'poison' && file.hasPoison && decision.poisonTarget ? 'poison' : 'none'
	      const action = { night: room.day, type, target: type === 'save' ? room.night.wolfKillTarget : type === 'poison' ? decision.poisonTarget : null, reason: decision.reason, source: decision.source, result: 'submitted' }
      file.actions.push(action)
      if (type === 'save') file.hasAntidote = false
      if (type === 'poison') file.hasPoison = false
      room.night.deaths = resolveNightDeaths(room)
      addGodEvent(room, { visibility: 'private', type: 'witch_action', actor: `${witch.id}号女巫`, content: `${witch.id}号女巫行动：${type === 'save' ? `救${room.night.wolfKillTarget}号` : type === 'poison' ? `毒${decision.poisonTarget}号` : '不用药'}。`, decision: action })
    }
  }

  if (!hasPendingExileSpeech(room) && await finishIfNeeded(room, mode)) return refreshFiles(room)
  if (!room.pendingSheriffElection && !room.pendingSheriffDecision && room.queue.length === 0 && room.status !== 'finished') room.queue = [...alivePlayers(room).map((player) => ({ type: 'day_speech', playerId: player.id })), ...alivePlayers(room).map((player) => ({ type: 'day_vote', playerId: player.id })), { type: 'exile' }]
  room.currentStep = room.pendingSheriffElection ? { type: 'sheriff_election' } : room.pendingSheriffDecision ? { type: 'sheriff_badge' } : room.queue[0]
  return refreshFiles(room)
}

const resolveSheriffElection = (inputRoom, action) => {
  const room = clone(inputRoom)
  if (!room.pendingSheriffElection) return refreshFiles(room)
  const candidates = room.publicFile.sheriff.candidates.filter((id) => playerById(room, id)?.alive)
  const selected = candidates.includes(Number(action.target)) ? Number(action.target) : candidates[0] ?? alivePlayers(room)[0]?.id ?? null
  room.publicFile.sheriff.id = selected
  room.publicFile.sheriff.history.push({ day: room.day, type: 'user_elected', playerId: selected, candidates })
  room.pendingSheriffElection = false
  addPublicEvent(room, { type: 'sheriff_elected', actor: '主持人', content: selected ? `用户选择${selected}号成为警长。` : '本局无人担任警长。', playerId: selected })
  room.currentStep = room.queue[0]
  return refreshFiles(room)
}

const resolveSheriffBadge = (inputRoom, action) => {
  const room = clone(inputRoom)
  const from = room.pendingSheriffDecision?.from
  if (!from) return refreshFiles(room)
  const transferTarget = action.type === 'transfer' ? legalTargetId(room, action.target, { exclude: [from] }) : null
  if (transferTarget) {
    room.publicFile.sheriff.id = transferTarget
    room.publicFile.sheriff.history.push({ day: room.day, type: 'transferred', from, to: transferTarget })
    addPublicEvent(room, { type: 'sheriff_badge_transfer', actor: `${from}号警长`, content: `${from}号警长死亡，将警徽递交给${transferTarget}号。`, from, to: transferTarget })
  } else {
    room.publicFile.sheriff.id = null
    room.publicFile.sheriff.history.push({ day: room.day, type: action.type === 'transfer' ? 'invalid_transfer_destroyed' : 'destroyed', from, requestedTarget: action.target ?? null })
    addPublicEvent(room, { type: 'sheriff_badge_destroyed', actor: `${from}号警长`, content: `${from}号警长死亡，选择撕毁警徽。`, from })
  }
  room.pendingSheriffDecision = null
  room.currentStep = room.queue[0]
  return refreshFiles(room)
}

export { AUTO_SPEEDS, MODEL_PROVIDERS, PERSONA_STYLES, ROLE_LABELS, ROOM_PRESETS, STEP_LABELS, TEAM_LABELS, advanceStep, alivePlayers, applyInitialSetup, createDefaultSetup, createRoom, refreshFiles, resolveSheriffBadge, resolveSheriffElection, sanitizePublicText }
