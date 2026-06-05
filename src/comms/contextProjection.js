import { createModelContext, visibleFilesFor } from '../game/files.js'
import { ROLE_LABELS } from '../game/constants.js'
import { getRoomRules } from '../game/rooms/index.js'
import { alivePlayers } from '../game/utils.js'

const clip = (value, max = 600) => String(value ?? '').slice(0, max)

const suspicionTargetsFromText = (text = '') => {
  const ids = []
  const patterns = [
    /(?:关注|怀疑|打|归票|投|踩|压|质疑|放逐)(\d+)号/g,
    /(\d+)号.{0,8}(?:可疑|狼面|动机|问题|矛盾|不干净|扛推|焦点)/g,
  ]
  for (const pattern of patterns) {
    for (const match of String(text).matchAll(pattern)) ids.push(Number(match[1]))
  }
  return ids.filter(Number.isFinite)
}

const consensusPressureFor = (room, player) => {
  const counts = new Map()
  const add = (target, weight, source) => {
    if (!target || target === player.id) return
    const item = counts.get(target) ?? { target, score: 0, sources: [] }
    item.score += weight
    item.sources.push(source)
    counts.set(target, item)
  }
  for (const speech of (room.publicFile?.speeches ?? []).filter((item) => item.day === room.day).slice(-room.players.length)) {
    for (const target of suspicionTargetsFromText(speech.content)) add(target, 1, `speech:${speech.playerId}`)
  }
  for (const vote of (room.publicFile?.votes ?? []).filter((item) => item.day === room.day).slice(-room.players.length)) {
    add(vote.target, 1.5, `vote:${vote.voter}`)
  }
  const ranked = [...counts.values()].sort((left, right) => right.score - left.score || left.target - right.target).slice(0, 3)
  const styleId = player.persona?.id ?? ''
  const challengeStyles = ['lone_independent', 'question_probe', 'calm_deconstruct', 'detail_picker', 'cautious_edge', 'fake_neutral', 'memory_compare']
  return {
    ranked,
    topTarget: ranked[0]?.target ?? null,
    ignoredTargets: room.players.filter((item) => item.alive && item.id !== player.id && !ranked.some((entry) => entry.target === item.id)).map((item) => item.id).slice(0, 3),
    assignment: challengeStyles.includes(styleId) ? 'challenge_or_compare_consensus' : 'require_independent_evidence_before_following',
  }
}

const channelForEvent = (event) => {
  if (event.visibility === 'public') return 'public_channel'
  if (event.visibility === 'private' && /狼/.test(String(event.actor ?? ''))) return 'wolf_channel'
  if (event.visibility === 'private') return 'role_private'
  if (event.visibility === 'debug') return 'debug_channel'
  return 'host_channel'
}

const publicChannelFor = (room) => ({
  name: 'public_channel',
  summary: room.publicFile?.publicSummary ?? null,
  players: (room.publicFile?.players ?? []).map((player) => ({
    id: player.id,
    alive: player.alive,
    publicRoleRevealed: player.publicRoleRevealed ?? null,
    death: player.alive ? null : {
      day: player.deathDay,
      phase: player.deathPhase,
      reason: player.publicDeathReason,
    },
  })),
  sheriff: {
    id: room.publicFile?.sheriff?.id ?? null,
    candidates: room.publicFile?.sheriff?.candidates ?? [],
    recentHistory: (room.publicFile?.sheriff?.history ?? []).slice(-3),
  },
  recentEvents: (room.publicFile?.publicEvents ?? []).slice(-8).map((event) => ({
    day: event.day,
    phase: event.phase,
    type: event.type,
    actor: event.actor,
    playerId: event.playerId ?? null,
    target: event.target ?? event.vote?.target ?? null,
    content: event.type === 'vote' ? clip(event.content, 260) : clip(event.content, 420),
  })),
  recentSpeeches: (room.publicFile?.speeches ?? []).slice(-5).map((speech) => ({
    day: speech.day,
    phase: speech.phase,
    playerId: speech.playerId,
    content: clip(speech.content, 500),
  })),
  recentVotes: (room.publicFile?.votes ?? []).slice(-room.players.length).map((vote) => ({
    day: vote.day,
    voter: vote.voter,
    target: vote.target,
    weight: vote.weight,
    reason: clip(vote.reason, 260),
  })),
  publicClaims: (room.publicFile?.publicClaims ?? []).slice(-8).map((claim) => ({
    playerId: claim.playerId,
    type: claim.type,
    content: clip(claim.content, 260),
    confidence: claim.confidence ?? 'public_claim_not_verified',
  })),
})

const chainSnapshotFor = (room, player, privateFile) => {
  const rules = getRoomRules(room.playerCount)
  const roleCounts = rules.roles.reduce((acc, role) => ({ ...acc, [role]: (acc[role] ?? 0) + 1 }), {})
  const alive = room.players.filter((item) => item.alive).map((item) => item.id)
  const deadUnrevealed = room.players.filter((item) => !item.alive && !item.publicRoleRevealed).map((item) => item.id)
  const roleClaims = (room.publicFile?.publicClaims ?? []).slice(-10).map((claim) => ({
    playerId: claim.playerId,
    type: claim.type,
    content: clip(claim.content, 180),
  }))
  const publicReads = (privateFile?.identityBoard ?? []).map((item) => ({
    playerId: item.playerId,
    status: item.publicStatus,
    known: item.known?.locked ? { team: item.known.team, role: item.known.role, source: item.known.source } : null,
    read: item.read ? {
      stance: item.read.stance,
      confidence: item.read.confidence,
      reasons: (item.read.reasons ?? []).slice(-2).map((reason) => clip(reason, 90)),
    } : null,
    claims: (item.claims ?? []).slice(-2).map((claim) => ({
      type: claim.type,
      content: clip(claim.content, 120),
    })),
  }))
  const latestVoteDay = Math.max(0, ...(room.publicFile?.votes ?? []).map((vote) => vote.day ?? 0))
  const latestVotes = (room.publicFile?.votes ?? []).filter((vote) => vote.day === latestVoteDay).map((vote) => ({
    voter: vote.voter,
    target: vote.target,
    reason: clip(vote.reason, 160),
  }))
  const voteGroups = latestVotes.reduce((acc, vote) => {
    acc[vote.target] ??= []
    acc[vote.target].push(vote.voter)
    return acc
  }, {})
  return {
    task: '内部同时检查身份说法、保踩关系、票路；公开发言自然表达，不照抄字段名。',
    setup: {
      playerCount: room.playerCount,
      roleCounts: Object.fromEntries(Object.entries(roleCounts).map(([role, count]) => [ROLE_LABELS[role] ?? role, count])),
      alive,
      deadUnrevealed,
    },
    identityChain: {
      roleClaims,
      note: '公开身份说法只是说法，除非 known.locked 或公开翻牌。',
    },
    alignmentChain: {
      publicReads,
      note: player.role === 'werewolf'
        ? '非狼队友私下已知为好人阵营；公开伪装找狼，私下看神职威胁和抗推位。'
        : '结合身份说法和发言关系排狼坑/好人坑，不只抓单句措辞。',
    },
    voteChain: {
      latestVoteDay: latestVoteDay || null,
      latestVotes,
      voteGroups,
      note: '票路只说明站边和压力流向，不直接证明身份。',
    },
  }
}

const wolfChannelFor = (room, player) => {
  if (player.role !== 'werewolf') return null
  return {
    name: 'wolf_channel',
    wolves: room.wolfTeamFile?.wolves ?? [],
    aliveWolves: room.wolfTeamFile?.aliveWolves ?? [],
    recentNightChats: (room.wolfTeamFile?.nightChats ?? []).slice(-2).map((chat) => ({
      night: chat.night,
      messages: (chat.messages ?? []).map((message) => ({
        playerId: message.playerId,
        content: clip(message.content, 500),
        killTarget: message.killTarget ?? null,
        reason: clip(message.reason, 260),
      })),
    })),
    recentNightKills: (room.wolfTeamFile?.nightKills ?? []).slice(-3),
  }
}

const rolePrivateChannelFor = (room, player) => {
  if (player.role === 'seer') return { name: `role_private:${player.id}`, role: 'seer', checks: room.roleFiles.seer[player.id]?.checks ?? [] }
  if (player.role === 'witch') {
    const file = room.roleFiles.witch[player.id]
    return {
      name: `role_private:${player.id}`,
      role: 'witch',
      hasAntidote: Boolean(file?.hasAntidote),
      hasPoison: Boolean(file?.hasPoison),
      currentNight: file?.currentNight ?? null,
      recentActions: (file?.actions ?? []).slice(-3),
    }
  }
  if (player.role === 'guard') {
    const file = room.roleFiles.guard[player.id]
    return {
      name: `role_private:${player.id}`,
      role: 'guard',
      currentNight: file?.currentNight ?? null,
      recentActions: (file?.actions ?? []).slice(-3),
    }
  }
  if (player.role === 'hunter') {
    const file = room.roleFiles.hunter[player.id]
    return {
      name: `role_private:${player.id}`,
      role: 'hunter',
      hasBullet: Boolean(file?.hasBullet),
      currentDeath: file?.currentDeath ?? null,
      shots: file?.shots ?? [],
    }
  }
  return null
}

const selfPrivateChannelFor = (room, player) => {
  const privateFile = visibleFilesFor(room, player)[`players/${player.id}/private.json`]
  return {
    name: `self_private:${player.id}`,
    identity: {
      playerId: player.id,
      role: player.role,
      team: player.team,
      roleLabel: player.roleLabel,
    },
    persona: privateFile?.styleProfile ?? null,
    roleStrategy: {
      winCondition: privateFile?.winCondition ?? null,
      notes: privateFile?.strategyNotes ?? [],
      readPolicy: privateFile?.readPolicy ?? null,
    },
    memory: {
      focusSuspicion: privateFile?.focusSuspicion ?? null,
      reasoningState: privateFile?.reasoningState ?? null,
      recentMemory: privateFile?.memory ?? [],
      consensusPressure: consensusPressureFor(room, player),
    },
    identityBoard: (privateFile?.identityBoard ?? []).map((item) => ({
      playerId: item.playerId,
      publicStatus: item.publicStatus,
      known: item.known,
      read: item.read,
      claims: item.claims,
    })),
    chainSnapshot: chainSnapshotFor(room, player, privateFile),
  }
}

const hostChannelFor = (room) => ({
  name: 'host_channel',
  room: {
    day: room.day,
    phase: room.phase,
    step: room.currentStep?.type ?? 'setup',
    status: room.status,
    winner: room.winner ?? null,
  },
  visibleTimeline: (room.godView?.timeline ?? []).slice(-12).map((event) => ({
    day: event.day,
    phase: event.phase,
    step: event.step,
    type: event.type,
    channel: channelForEvent(event),
    actor: event.actor,
    content: clip(event.content, 420),
  })),
})

const buildChannelsForPlayer = (room, player) => ({
  public: publicChannelFor(room),
  wolf: wolfChannelFor(room, player),
  rolePrivate: rolePrivateChannelFor(room, player),
  selfPrivate: selfPrivateChannelFor(room, player),
})

const buildContextProjection = (room, player, { includeHost = false } = {}) => {
  const modelContext = createModelContext(room, player)
  const channels = buildChannelsForPlayer(room, player)
  return {
    version: 1,
    gameId: room.id,
    actor: { id: player.id, role: player.role, team: player.team, alive: player.alive },
    task: modelContext.task,
    budgetHints: {
      publicEventsLimit: channels.public.recentEvents.length,
      recentSpeechesLimit: channels.public.recentSpeeches.length,
      alivePlayers: alivePlayers(room).map((item) => item.id),
    },
    access: modelContext.access,
    facts: {
      knownFacts: modelContext.knownFacts,
      unknowns: modelContext.unknowns,
      factBoundaries: modelContext.factBoundaries,
      legalAction: modelContext.legalAction,
      publicClaims: modelContext.publicClaims,
      chainSnapshot: channels.selfPrivate.chainSnapshot,
    },
    styleAndMemory: {
      persona: channels.selfPrivate.persona,
      roleStrategy: channels.selfPrivate.roleStrategy,
      memory: channels.selfPrivate.memory,
      antiBandwagon: channels.selfPrivate.memory.consensusPressure,
    },
    channels: {
      public_channel: channels.public,
      wolf_channel: channels.wolf,
      [`role_private:${player.id}`]: channels.rolePrivate,
      [`self_private:${player.id}`]: channels.selfPrivate,
      ...(includeHost ? { host_channel: hostChannelFor(room) } : {}),
    },
  }
}

const formatProjectionForPrompt = (projection) => [
  '--- context_projection.json ---',
  JSON.stringify(projection),
].join('\n')

export { buildChannelsForPlayer, buildContextProjection, formatProjectionForPrompt }
