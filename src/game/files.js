import { GAME_RULES, WIN_CONDITIONS } from './constants.js'
import { alivePlayers, aliveWolves, legalTargets, roleTeam } from './utils.js'

const clip = (value, max = 160) => String(value ?? '').slice(0, max)

const createStyleProfile = (player) => {
  const persona = player.persona ?? {}
  return {
    styleId: persona.id ?? 'balanced',
    name: persona.name ?? '自然平衡型',
    languageStyle: persona.languageStyle ?? '自然表达，避免模板化复读。',
    thinkingStyle: persona.thinkingStyle ?? '结合角色目标与公开信息给出判断。',
    conflictStyle: persona.conflictStyle ?? '按局势强弱调整冲突力度。',
    voteStyle: persona.voteStyle ?? '投向公开逻辑最不自洽的位置。',
    claimStyle: persona.claimStyle ?? '身份表达服从规则、局势和可见信息。',
    roleFit: persona.roleFit ?? [],
    speechGuidance: [
      `语言风格：${persona.languageStyle ?? '自然表达，避免模板化复读。'}`,
      `思考方式：${persona.thinkingStyle ?? '结合角色目标与公开信息给出判断。'}`,
      `冲突方式：${persona.conflictStyle ?? '按局势强弱调整冲突力度。'}`,
      '风格只能影响语气、节奏、风险偏好和表达质量，不能覆盖规则、可见文件权限或合法目标。',
      '公开发言不要直接说出风格画像名称或内部字段。',
    ],
  }
}

const knownIdentityFor = (room, viewer, target) => {
  if (target.id === viewer.id) return { team: target.team, role: target.role, locked: true, source: 'self' }
  if (viewer.role === 'werewolf' && target.role === 'werewolf') return { team: 'wolf', role: 'werewolf', locked: true, source: 'wolf_team' }
  if (viewer.role === 'werewolf') return { team: 'good', role: 'unknown', locked: true, source: 'wolf_team_exclusion', note: '狼人知道非狼队友属于好人阵营，但不知道具体神民身份。' }
  if (target.publicRoleRevealed) return { team: roleTeam(target.publicRoleRevealed), role: target.publicRoleRevealed, locked: true, source: 'public_reveal' }
  if (viewer.role === 'seer') {
    const check = (room.roleFiles.seer[viewer.id]?.checks ?? []).find((item) => Number(item.target) === Number(target.id))
    if (check?.result === 'wolf') return { team: 'wolf', role: 'werewolf', locked: true, source: `seer_check_N${check.night}` }
    if (check?.result === 'not_wolf') return { team: 'good', role: 'unknown', locked: true, source: `seer_check_N${check.night}`, note: '查验只证明非狼人，不证明具体神民身份。' }
  }
  return { team: 'unknown', role: 'unknown', locked: false, source: 'none' }
}

const claimsForPlayer = (room, playerId) => (room.publicFile?.publicClaims ?? [])
  .filter((claim) => Number(claim.playerId) === Number(playerId))
  .slice(-3)
  .map((claim) => ({ type: claim.type, content: clip(claim.content, 80), confidence: claim.confidence }))

const createIdentityBoard = (room, viewer) => room.players.map((target) => {
  const known = knownIdentityFor(room, viewer, target)
  const storedRead = viewer.identityReads?.[target.id]
  const read = known.locked && known.role !== 'unknown' ? null : {
    alignment: storedRead?.alignment ?? (viewer.role === 'werewolf' && target.role !== 'werewolf' ? 'known_good_target' : 'unknown'),
    role: storedRead?.role ?? 'unknown',
    roleConfidence: storedRead?.roleConfidence ?? 'low',
    threatLevel: storedRead?.threatLevel ?? (viewer.role === 'werewolf' && target.role !== 'werewolf' ? 'medium' : 'unknown'),
    actionPriority: storedRead?.actionPriority ?? (viewer.role === 'werewolf' && target.role !== 'werewolf' ? 'infer_power_role' : 'observe'),
    reason: clip(storedRead?.reason ?? '暂无独立推理。', 100),
    updatedAt: storedRead?.updatedAt ?? 'setup',
  }
  return {
    playerId: target.id,
    publicStatus: target.alive ? 'alive' : 'dead',
    known,
    claims: claimsForPlayer(room, target.id),
    read,
  }
})

const createPrivateFile = (room, player) => ({
  playerId: player.id,
  role: player.role,
  roleLabel: player.roleLabel,
  team: player.team,
  winCondition: WIN_CONDITIONS[player.role],
  styleProfile: createStyleProfile(player),
  model: player.model,
  memory: player.memory.slice(-3).map((item) => clip(item, 120)),
  strategyNotes: player.strategyNotes,
  focusSuspicion: player.focusSuspicion,
  identityBoard: createIdentityBoard(room, player),
  readPolicy: player.role === 'werewolf'
    ? {
      goal: '狼人已知狼队友和非狼队友阵营；白天伪装找狼，私下重点推理神职身份、威胁等级和刀口/抗推优先级。',
      updateFields: ['read.role', 'read.threatLevel', 'read.actionPriority', 'read.reason'],
      avoid: ['不要把非狼队友继续推理成狼人；公开发言可以伪装，但私有 read 应服务于找神、找刀口和抗推路线。'],
    }
    : {
      goal: '好人重点推理谁是狼人，同时记录公开跳身份是否可信。',
      updateFields: ['read.alignment', 'read.role', 'read.reason'],
      avoid: ['不要把 publicClaims 当事实；known.locked=false 的身份都只能是推理。'],
    },
  reasoningState: {
    currentRead: player.reasoningState?.currentRead ?? null,
    evidenceLedger: (player.reasoningState?.evidenceLedger ?? []).slice(-4).map((item) => ({ ...item, evidence: clip(item.evidence, 120) })),
    dissentNotes: (player.reasoningState?.dissentNotes ?? []).slice(-2).map((item) => clip(item, 120)),
    antiBandwagon: player.reasoningState?.antiBandwagon ?? { requireOwnEvidence: true },
  },
})

const createPublicFile = (room) => ({
  room: { day: room.day, phase: room.phase, step: room.currentStep?.type ?? 'setup', status: room.status, winner: room.winner ?? null, playerCount: room.players.length, preset: room.preset },
  sheriff: room.publicFile?.sheriff ?? { enabled: true, id: null, voteWeight: 1.5, candidates: [], history: [] },
  players: room.players.map((player) => ({ id: player.id, alive: player.alive, publicStatus: player.alive ? 'alive' : 'dead', deathDay: player.death?.day ?? null, deathPhase: player.death?.phase ?? null, publicDeathReason: player.death?.publicReason ?? null, publicRoleRevealed: player.publicRoleRevealed ?? null })),
  publicSummary: room.publicFile?.publicSummary ?? { version: 1, updatedAt: 'setup', text: '对局刚开始，暂无公共摘要。', keyClaims: [], votePatterns: [], deadPlayers: [], recentEvents: [] },
  announcements: room.publicFile?.announcements ?? [],
  speeches: room.publicFile?.speeches ?? [],
  lastWords: room.publicFile?.lastWords ?? [],
  votes: room.publicFile?.votes ?? [],
  deaths: room.publicFile?.deaths ?? [],
  exiles: room.publicFile?.exiles ?? [],
  hunterShots: room.publicFile?.hunterShots ?? [],
  publicClaims: room.publicFile?.publicClaims ?? [],
  publicEvents: room.publicFile?.publicEvents ?? [],
})

const createRoleFiles = (room, player) => {
  const files = {}
  if (player.role === 'seer') files[`players/${player.id}/seer_checks.json`] = room.roleFiles.seer[player.id]
  if (player.role === 'witch') files[`players/${player.id}/witch.json`] = room.roleFiles.witch[player.id]
  if (player.role === 'guard') files[`players/${player.id}/guard.json`] = room.roleFiles.guard[player.id]
  if (player.role === 'hunter') files[`players/${player.id}/hunter.json`] = room.roleFiles.hunter[player.id]
  return files
}

const PUBLIC_AI_LIMITS = {
  sheriffHistory: 3,
  announcements: 3,
  announcementChars: 100,
  speeches: 4,
  speechChars: 150,
  lastWords: 2,
  lastWordChars: 160,
  voteRounds: 1,
  voteReasonChars: 80,
  publicEvents: 6,
  publicEventChars: 120,
}

const fileReadRank = (name) => {
  if (name.endsWith('/model_context.json')) return 0
  if (name.endsWith('/private.json')) return 1
  if (name.endsWith('/seer_checks.json') || name.endsWith('/witch.json') || name.endsWith('/guard.json') || name.endsWith('/hunter.json') || name === 'wolf_team.json') return 2
  if (name === 'public.json') return 3
  return 9
}

const orderFileEntries = (files) => Object.entries(files)
  .sort(([left], [right]) => fileReadRank(left) - fileReadRank(right) || left.localeCompare(right))

const compactPublicFileForAi = (room) => ({
  room: room.publicFile.room,
  sheriff: {
    id: room.publicFile.sheriff?.id ?? null,
    voteWeight: room.publicFile.sheriff?.voteWeight ?? 1.5,
    candidates: room.publicFile.sheriff?.candidates ?? [],
    recentHistory: (room.publicFile.sheriff?.history ?? []).slice(-PUBLIC_AI_LIMITS.sheriffHistory),
  },
  players: room.publicFile.players.map((player) => {
    const compact = { id: player.id, alive: player.alive }
    if (!player.alive) compact.death = { day: player.deathDay, phase: player.deathPhase, reason: player.publicDeathReason }
    if (player.publicRoleRevealed) compact.publicRoleRevealed = player.publicRoleRevealed
    return compact
  }),
  publicSummary: room.publicFile.publicSummary,
  recentAnnouncements: room.publicFile.announcements.slice(-PUBLIC_AI_LIMITS.announcements).map((item) => ({ ...item, content: clip(item.content, PUBLIC_AI_LIMITS.announcementChars) })),
  recentSpeeches: room.publicFile.speeches.slice(-PUBLIC_AI_LIMITS.speeches).map((item) => ({ day: item.day, phase: item.phase, playerId: item.playerId, content: clip(item.content, PUBLIC_AI_LIMITS.speechChars) })),
  recentLastWords: room.publicFile.lastWords.slice(-PUBLIC_AI_LIMITS.lastWords).map((item) => ({ day: item.day, playerId: item.playerId, content: clip(item.content, PUBLIC_AI_LIMITS.lastWordChars), source: item.source })),
  recentVotes: room.publicFile.votes.slice(-room.players.length * PUBLIC_AI_LIMITS.voteRounds).map((vote) => ({ day: vote.day, voter: vote.voter, target: vote.target, weight: vote.weight, reason: clip(vote.reason, PUBLIC_AI_LIMITS.voteReasonChars) })),
  publicClaims: buildPublicClaims(room),
  deaths: room.publicFile.deaths,
  exiles: room.publicFile.exiles,
  hunterShots: room.publicFile.hunterShots,
  recentPublicEvents: room.publicFile.publicEvents.slice(-PUBLIC_AI_LIMITS.publicEvents).map((event) => {
    const compact = { day: event.day, phase: event.phase, type: event.type, actor: event.actor }
    if (event.playerId) compact.playerId = event.playerId
    if (event.target) compact.target = event.target
    if (event.type !== 'vote') compact.content = clip(event.content, PUBLIC_AI_LIMITS.publicEventChars)
    return compact
  }),
})

const roleClaimFromText = (content = '') => {
  const text = String(content)
  if (/预言家|查验|金水|查杀/.test(text)) return 'seer_claim'
  if (/女巫|解药|毒药|救了|毒了/.test(text)) return 'witch_claim'
  if (/守卫|守护|盾/.test(text)) return 'guard_claim'
  if (/猎人|开枪|带走/.test(text)) return 'hunter_claim'
  if (/平民|民牌|闭眼/.test(text)) return 'villager_claim'
  return null
}

const buildPublicClaims = (room) => {
  const speechClaims = (room.publicFile.speeches ?? []).slice(-12).flatMap((speech) => {
    const claimType = roleClaimFromText(speech.content)
    return claimType ? [{
      day: speech.day,
      phase: speech.phase,
      playerId: speech.playerId,
      type: claimType,
      content: String(speech.content).slice(0, 100),
      confidence: 'public_claim_not_verified',
    }] : []
  })
  return [...(room.publicFile.publicClaims ?? []), ...speechClaims].slice(-12)
}

const publicKnownFacts = (room) => {
  const living = alivePlayers(room).map((player) => player.id)
  const dead = room.players.filter((player) => !player.alive).map((player) => ({
    id: player.id,
    day: player.death?.day ?? null,
    phase: player.death?.phase ?? null,
    publicReason: player.death?.publicReason ?? null,
    revealedRole: player.publicRoleRevealed ?? null,
  }))
  return [
    `state:D${room.day}/${room.phase}/${room.currentStep?.type ?? 'setup'}`,
    `alive:${living.length ? living.join(',') : 'none'}`,
    dead.length ? `dead:${dead.map((item) => `${item.id}:${item.publicReason ?? 'unknown'}${item.revealedRole ? `:${item.revealedRole}` : ''}`).join('|')}` : 'dead:none',
    `sheriff:${room.publicFile.sheriff?.id ?? 'none'}`,
  ]
}

const roleKnownFacts = (room, player) => {
  const facts = [`self:${player.id}:${player.role}:${player.team}`]
  if (player.role === 'werewolf') facts.push(`wolves:${room.wolfTeamFile.wolves.join(',')}`)
  if (player.role === 'seer') {
    const checks = room.roleFiles.seer[player.id]?.checks ?? []
    facts.push(checks.length ? `seer_checks:${checks.map((check) => `N${check.night}:${check.target}:${check.result}`).join('|')}` : 'seer_checks:none')
  }
  if (player.role === 'witch') {
    const file = room.roleFiles.witch[player.id]
    facts.push(`witch_meds:antidote=${file?.hasAntidote ? 1 : 0},poison=${file?.hasPoison ? 1 : 0}`)
    if (file?.currentNight) {
      facts.push(`witch_kill_seen:${file.currentNight.canSeeKillTarget ? file.currentNight.killTarget ?? 'none' : 'hidden'}`)
    }
  }
  if (player.role === 'guard') {
    const currentNight = room.roleFiles.guard[player.id]?.currentNight
    facts.push(`guard_cannot_repeat:${currentNight?.cannotRepeatTarget ?? 'none'}`)
  }
  if (player.role === 'hunter') {
    const file = room.roleFiles.hunter[player.id]
    facts.push(`hunter_bullet:${file?.hasBullet ? 1 : 0}`)
    if (file?.currentDeath) facts.push(`hunter_current_death:${file.currentDeath.cause}:canShoot=${file.currentDeath.canShoot ? 1 : 0}`)
  }
  return facts
}

const unknownBoundaries = (room, player) => {
  const boundaries = [
    'public_only_use_public_facts_and_claims',
    'unrevealed_role_is_unknown',
    'exile_does_not_reveal_role',
    'dead_player_role_unknown_without_publicRoleRevealed',
    'public_claim_is_not_truth',
    'night_death_cause_is_unknown_unless_public',
  ]
  if (player.role !== 'werewolf') boundaries.push('no_wolf_team_or_chat_access')
  if (player.role !== 'seer') boundaries.push('no_private_seer_results')
  if (player.role === 'witch') boundaries.push('kill_target_does_not_prove_good_side_self_kill_allowed')
  if (player.role !== 'witch') boundaries.push('no_witch_action_access')
  if (player.role !== 'guard') boundaries.push('no_guard_target_access')
  return boundaries
}

const factBoundariesFor = (room, player) => {
  const publicDeadWithoutReveal = room.players
    .filter((item) => !item.alive && !item.publicRoleRevealed)
    .map((item) => item.id)
  const boundaries = [
    '公开死亡只证明该玩家出局，不证明阵营或身份。',
    '放逐结算不公开翻牌，除非 publicRoleRevealed 有值。',
    '公开发言中的身份、查验、用药都只是 publicClaims，不是事实。',
    '平安夜不影响预言家查验结果；不能用无死讯否定查验，只能质疑跳身份动机。',
    '平安夜本身不能作为预言家查杀时机可疑的理由；质疑预言家必须使用发言、对跳、票型或行为依据。',
    '女巫前一晚没救人不代表后一晚不能救人；只要解药未使用，后续夜晚救人不构成时间线矛盾。',
    '全票、多数票或被放逐不能证明身份或阵营。',
    '跟随热门归票必须给自己的独立公开依据，不能把“多数人已投/大家都这么说/跟票”当作主要理由。',
    'private.identityBoard 中 known.locked=true 的身份事实不能改写；read 只能记录可变推理。',
  ]
  if (publicDeadWithoutReveal.length) boundaries.push(`${publicDeadWithoutReveal.join('、')}号已出局但未公开身份，不能说其已证实为狼人或好人。`)
  if (player.role === 'witch') boundaries.push('女巫看到或救起刀口只证明该玩家曾是刀口；狼人允许自刀，不能推出该玩家是好人。')
  if (player.role === 'werewolf') boundaries.push('狼人私有文件已知非狼队友属于好人阵营；私有推理重点应是神职身份、威胁等级、刀口和抗推优先级，而不是继续怀疑谁是狼。')
  return boundaries
}

const accessibleFileNamesFor = (player) => {
  const names = [
    `players/${player.id}/model_context.json`,
    `players/${player.id}/private.json`,
  ]
  if (player.role === 'werewolf') names.push('wolf_team.json')
  if (player.role === 'seer') names.push(`players/${player.id}/seer_checks.json`)
  if (player.role === 'witch') names.push(`players/${player.id}/witch.json`)
  if (player.role === 'guard') names.push(`players/${player.id}/guard.json`)
  if (player.role === 'hunter') names.push(`players/${player.id}/hunter.json`)
  names.push('public.json')
  return names
}

const legalActionFor = (room, player) => {
  const type = room.currentStep?.type ?? 'unknown'
  const aliveIds = alivePlayers(room).map((target) => target.id)
  if (type === 'day_vote') {
    return {
      task: type,
      schema: { target: 'number', reason: 'string' },
      legalTargets: legalTargets(room).map((target) => target.id),
      publicOnly: true,
      notes: player.role === 'werewolf' ? ['狼人可以公开投队友做身份，但理由必须使用公开信息。'] : [],
    }
  }
  if (['day_speech', 'sheriff_speech', 'exile_speech'].includes(type)) {
    return {
      task: type,
      schema: { content: 'string', focusSuspicion: { target: 'number', reason: 'string' } },
      legalFocusTargets: legalTargets(room, { exclude: [player.id] }).map((target) => target.id),
      publicOnly: true,
    }
  }
  if (type === 'wolf_chat') {
    return {
      task: type,
      schema: { content: 'string', killTarget: 'number', reason: 'string' },
      legalKillTargets: aliveIds,
      privateOnly: true,
      notes: ['狼队允许自刀狼人做身份。'],
    }
  }
  if (type === 'seer_check') {
    const checked = new Set((room.roleFiles.seer[player.id]?.checks ?? []).map((check) => check.target))
    const uncheckedTargets = legalTargets(room, { exclude: [player.id, ...checked] }).map((target) => target.id)
    return {
      task: type,
      schema: { target: 'number', reason: 'string' },
      legalTargets: uncheckedTargets.length ? uncheckedTargets : legalTargets(room, { exclude: [player.id] }).map((target) => target.id),
      privateOnly: true,
    }
  }
  if (type === 'guard_action') {
    const currentNight = room.roleFiles.guard[player.id]?.currentNight
    return {
      task: type,
      schema: { target: 'number', reason: 'string' },
      legalTargets: currentNight?.availableTargets ?? legalTargets(room).map((target) => target.id),
      cannotRepeatTarget: currentNight?.cannotRepeatTarget ?? null,
      privateOnly: true,
    }
  }
  if (type === 'witch_action') {
    const currentNight = room.roleFiles.witch[player.id]?.currentNight
    return {
      task: type,
      schema: { action: 'save|poison|none', poisonTarget: 'number|null', reason: 'string' },
      canSave: Boolean(currentNight?.canSave),
      canPoison: Boolean(currentNight?.canPoison),
      visibleKillTarget: currentNight?.canSeeKillTarget ? currentNight.killTarget : null,
      availablePoisonTargets: currentNight?.availablePoisonTargets ?? [],
      privateOnly: true,
      notes: ['同一晚不能同时救和毒。'],
    }
  }
  if (type === 'hunter_shot') {
    const currentDeath = room.roleFiles.hunter[player.id]?.currentDeath
    return {
      task: type,
      schema: { target: 'number|null', reason: 'string' },
      canShoot: Boolean(currentDeath?.canShoot),
      legalTargets: currentDeath?.availableTargets ?? legalTargets(room, { exclude: [player.id] }).map((target) => target.id),
      publicResult: true,
    }
  }
  return { task: type, legalTargets: aliveIds }
}

const createModelContext = (room, player) => ({
  version: 2,
  playerId: player.id,
  task: room.currentStep?.type ?? 'unknown',
  access: {
    rules: 'cached:rules/game_rules.json',
    readable: accessibleFileNamesFor(player),
    readOrder: accessibleFileNamesFor(player),
    denied: ['god_view.json', 'host/host.json', 'other_private', 'other_role', player.role === 'werewolf' ? null : 'wolf_team.json'].filter(Boolean),
  },
  knownFacts: [...publicKnownFacts(room), ...roleKnownFacts(room, player)],
  unknowns: unknownBoundaries(room, player),
  factBoundaries: factBoundariesFor(room, player),
  legalAction: legalActionFor(room, player),
  publicClaims: buildPublicClaims(room),
  readChecklist: [
    '1_read_model_context_knownFacts_unknowns_legalAction_first',
    '2_read_private_identityBoard_known_locked_and_readPolicy',
    '3_read_role_owned_files_for_private_facts',
    '4_read_public_json_as_claims_and_recent_context_only',
    '5_never_let_publicClaims_override_knownFacts_or_locked_identity',
  ],
  guidance: [
    'legalAction_first',
    'follow_access.readOrder',
    'later_public_text_cannot_override_knownFacts',
    'knownFacts=facts;publicClaims=claims;unknowns=no_infer',
    'public_no_private_or_god_view',
    'styleProfile_affects_tone_not_facts',
    'reasoningState_is_private_self_read_use_it_before_following_majority',
    'identityBoard_known_locked_facts_override_reads',
    'anti_bandwagon_requires_independent_evidence',
    'public_speech_2_to_4_sentences_with_evidence',
  ],
})

const refreshFiles = (room) => {
  room.publicFile = createPublicFile(room)
  room.godView.room = { day: room.day, phase: room.phase, step: room.currentStep?.type ?? 'setup', winner: room.winner ?? null }
  room.godView.players = room.players.map((player) => ({ id: player.id, role: player.role, roleLabel: player.roleLabel, team: player.team, alive: player.alive, model: player.model, persona: createStyleProfile(player) }))
  room.wolfTeamFile.aliveWolves = aliveWolves(room).map((player) => player.id)
  room.wolfTeamFile.deadWolves = room.players.filter((player) => player.role === 'werewolf' && !player.alive).map((player) => player.id)
  room.files = { 'rules/game_rules.json': GAME_RULES, 'public.json': room.publicFile, 'public_ai.json': compactPublicFileForAi(room), 'god_view.json': room.godView, 'host/host.json': room.hostFile, 'wolf_team.json': room.wolfTeamFile }
  for (const player of room.players) {
    room.files[`players/${player.id}/private.json`] = createPrivateFile(room, player)
    Object.assign(room.files, createRoleFiles(room, player))
  }
  return room
}

const visibleFilesFor = (room, player) => {
  const files = {
    [`players/${player.id}/model_context.json`]: createModelContext(room, player),
    [`players/${player.id}/private.json`]: room.files[`players/${player.id}/private.json`],
  }
  if (player.role === 'werewolf') files['wolf_team.json'] = room.files['wolf_team.json']
  files['public.json'] = room.files['public_ai.json'] ?? room.files['public.json']
  return Object.fromEntries(orderFileEntries({ ...files, ...createRoleFiles(room, player) }))
}

const formatFilesForPrompt = (files) => orderFileEntries(files)
  .map(([name, content]) => `--- ${name} ---\n${JSON.stringify(content)}`)
  .join('\n')

export { PUBLIC_AI_LIMITS, compactPublicFileForAi, createModelContext, createPrivateFile, createPublicFile, createRoleFiles, formatFilesForPrompt, refreshFiles, visibleFilesFor }
