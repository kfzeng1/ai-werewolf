import { callModelDetailed, modelNameForProvider, normalizeProvider } from '../services/modelProvider.js'
import { buildContextProjection, formatProjectionForPrompt } from '../comms/contextProjection.js'
import {
  AI_SYSTEM_PREFIX,
  RULES_CACHE_MESSAGE,
  exileSpeechPrompt,
  fallbackVoteReason,
  guardPrompt,
  hunterShotPrompt,
  legalFallbackTarget,
  publicSpeechPrompt,
  seerCheckPrompt,
  votePrompt,
  witchPrompt,
  wolfChatPrompt,
} from '../agents/prompts.js'
import { naturalFallbackText } from '../agents/personaSpeech.js'
import { validateDecision } from '../agents/validators.js'
import { MODEL_PRICES_PER_MILLION, ROLE_LABELS } from './constants.js'
import { normalizeTarget, parseJsonObject } from './utils.js'

const DECISION_BUDGETS = {
  sheriff_speech: { thinking: 'disabled', temperature: 0.72 },
  day_speech: { thinking: 'disabled', temperature: 0.72 },
  exile_speech: { thinking: 'disabled', temperature: 0.7 },
  wolf_chat: { thinking: 'disabled', temperature: 0.62 },
  day_vote: { thinking: 'disabled', temperature: 0.45 },
  seer_check: { thinking: 'disabled', temperature: 0.35 },
  guard_action: { thinking: 'disabled', temperature: 0.35 },
  witch_action: { thinking: 'disabled', temperature: 0.35 },
  hunter_shot: { thinking: 'disabled', temperature: 0.45 },
}

const shouldCallModel = (mode) => normalizeProvider(mode) === 'deepseek'

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
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    day: room.day,
    step: room.currentStep?.type ?? meta?.step ?? 'unknown',
    kind: meta?.kind ?? 'unknown',
    playerId: meta?.playerId ?? null,
    role: meta?.role ?? null,
    provider: meta?.provider ?? 'deepseek',
    model: normalizedModel,
    attempt: meta?.attempt ?? 1,
    localCacheHit,
    durationMs,
    finishReason,
    error,
    usage: parts,
    estimatedUsd: localCacheHit ? 0 : estimateCostUsd(normalizedModel, usage),
  })
}

const recordAiFallback = (room, meta, error) => {
  room.godView.debug.aiFallbacks ??= []
  room.godView.debug.aiFallbacks.push({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    day: room.day,
    step: room.currentStep?.type ?? meta?.step ?? 'unknown',
    kind: meta?.kind ?? 'unknown',
    playerId: meta?.playerId ?? null,
    role: meta?.role ?? null,
    attempt: meta?.attempt ?? 1,
    error: String(error || 'unknown fallback'),
  })
}

const normalizeSpeakerLabel = (player, text) => String(text || '').replace(/^\s*\d+号(发言|警上发言|出局发言|投给)/, `${player.id}号$1`)

const sanitizePublicText = (player, text, fallback, target = player.focusSuspicion?.target, room = null) => {
  void fallback
  void target
  void room
  return normalizeSpeakerLabel(player, text)
}

const recordValidationResult = (room, player, kind, decision, result) => {
  room.godView.debug.validationResults ??= []
  room.godView.debug.validationResults.push({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    day: room.day,
    step: room.currentStep?.type ?? kind,
    kind,
    playerId: player.id,
    role: player.role,
    valid: result.valid,
    violations: result.violations,
    decisionPreview: JSON.stringify(decision ?? {}).slice(0, 240),
  })
}

const validateAndRecordDecision = (room, player, kind, decision) => {
  const result = validateDecision(room, player, kind, decision)
  recordValidationResult(room, player, kind, decision, result)
  return result
}

const aiDecision = async (room, player, kind, instruction, fallback) => {
  const budget = DECISION_BUDGETS[kind] ?? { thinking: 'disabled', temperature: 0.55 }
  const provider = normalizeProvider(room.modelProvider ?? 'deepseek')
  const baseMessages = [
    { role: 'system', content: AI_SYSTEM_PREFIX },
    { role: 'system', content: RULES_CACHE_MESSAGE },
    { role: 'system', content: instruction },
    { role: 'user', content: `你是${player.id}号${ROLE_LABELS[player.role]}。\n${formatProjectionForPrompt(buildContextProjection(room, player))}` },
  ]
  let lastReason = ''
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const meta = { kind, provider, playerId: player.id, role: player.role, day: room.day, step: room.currentStep?.type, attempt }
    const retryMessage = attempt === 1 ? [] : [{ role: 'system', content: `上一次调用失败或输出不可用：${lastReason || '未知原因'}。现在重新生成，必须只输出一个完整 JSON 对象；不能输出空内容、解释、Markdown、代码块或 JSON 外文本。` }]
    try {
      const result = await callModelDetailed({
        provider,
        model: modelNameForProvider(provider),
        thinking: budget.thinking,
        temperature: attempt === 1 ? budget.temperature : Math.max((budget.temperature ?? 0.55) - 0.15, 0.2),
        meta,
        messages: [...baseMessages, ...retryMessage],
      })
      recordAiUsage(room, { model: result.model ?? modelNameForProvider(provider), meta, usage: result.usage, localCacheHit: result.localCacheHit, finishReason: result.finishReason })
      const parsed = parseJsonObject(result.content)
      if (parsed) return { parsed, source: result.localCacheHit ? 'cache' : attempt === 1 ? 'ai' : 'ai-retry' }
      lastReason = `AI返回内容不是合法JSON${result.finishReason ? `，finish_reason=${result.finishReason}` : ''}${attempt > 1 ? '，retry=1' : ''}`
    } catch (error) {
      lastReason = `${error.message}${attempt > 1 ? '，retry=1' : ''}`
    }
  }
  const meta = { kind, provider, playerId: player.id, role: player.role, day: room.day, step: room.currentStep?.type, attempt: 2 }
  recordAiFallback(room, meta, lastReason)
  return { parsed: fallback, source: 'fallback', error: lastReason }
}

const decideSpeech = async (room, player, mode) => {
  const fallbackTarget = legalFallbackTarget(room, player, { exclude: [player.id] })
  const fallbackFocus = { target: fallbackTarget, reason: fallbackTarget === player.focusSuspicion?.target ? player.focusSuspicion.reason : '按存活名单和公开压力位重新评估。' }
  const fallback = { content: naturalFallbackText(player, fallbackFocus.target), focusSuspicion: fallbackFocus }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, player, 'day_speech', publicSpeechPrompt('白天', room, player), fallback)
  const parsed = { ...fallback, ...(result.parsed ?? {}) }
  validateAndRecordDecision(room, player, 'day_speech', parsed)
  return { ...parsed, content: sanitizePublicText(player, parsed.content, fallback.content, parsed.focusSuspicion?.target, room), source: result.source, error: result.error }
}

const decideSheriffSpeech = async (room, player, mode) => {
  const fallbackTarget = legalFallbackTarget(room, player, { exclude: [player.id] })
  const fallbackFocus = { target: fallbackTarget, reason: '警上先按发言顺序、上警动机和对跳压力观察。' }
  const fallback = { content: naturalFallbackText(player, fallbackTarget, '警上发言'), focusSuspicion: fallbackFocus }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, player, 'sheriff_speech', publicSpeechPrompt('警长竞选', room, player), fallback)
  const parsed = { ...fallback, ...(result.parsed ?? {}) }
  validateAndRecordDecision(room, player, 'sheriff_speech', parsed)
  return { ...parsed, content: sanitizePublicText(player, parsed.content, fallback.content, parsed.focusSuspicion?.target, room), source: result.source, error: result.error }
}

const decideVote = async (room, player, mode) => {
  const voteOptions = player.role === 'werewolf' ? { exclude: [player.id], teamNot: 'wolf' } : { exclude: [player.id] }
  const fallbackTarget = legalFallbackTarget(room, player, voteOptions)
  const fallback = { target: fallbackTarget, reason: fallbackVoteReason(fallbackTarget) }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, player, 'day_vote', votePrompt(room, player), fallback)
  const target = normalizeTarget(room, result.parsed?.target, fallbackTarget, voteOptions)
  const decision = { ...result.parsed, target, reason: result.parsed?.reason || fallbackVoteReason(target) }
  validateAndRecordDecision(room, player, 'day_vote', decision)
  return { target, reason: sanitizePublicText(player, decision.reason, fallbackVoteReason(target), target, room), source: result.source, error: result.error }
}

const decideExileSpeech = async (room, player, mode) => {
  const fallbackTarget = legalFallbackTarget(room, player, { exclude: [player.id] })
  const fallbackFocus = { target: fallbackTarget, reason: '从投票推动和跟票理由里继续找狼坑。' }
  const fallback = { content: `${player.id}号出局发言：我不公开翻身份，只建议复盘今天票型、归票过程和跟票理由，重点看${fallbackTarget ?? '冲票位'}号附近的推动关系。`, focusSuspicion: fallbackFocus }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, player, 'exile_speech', exileSpeechPrompt, fallback)
  const parsed = { ...fallback, ...(result.parsed ?? {}) }
  validateAndRecordDecision(room, player, 'exile_speech', parsed)
  return { ...parsed, content: sanitizePublicText(player, parsed.content, fallback.content, parsed.focusSuspicion?.target, room), source: result.source, error: result.error }
}

const decideWolfChat = async (room, wolf, mode) => {
  const fallbackTarget = legalFallbackTarget(room, wolf)
  const fallback = { content: `${wolf.id}号建议刀${fallbackTarget}号，必要时可以自刀做身份。`, killTarget: fallbackTarget, reason: `${fallbackTarget}号当前最适合作为狼队刀口。` }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, wolf, 'wolf_chat', wolfChatPrompt, fallback)
  const killTarget = normalizeTarget(room, result.parsed?.killTarget, fallbackTarget)
  const decision = { content: result.parsed?.content || fallback.content, killTarget, reason: result.parsed?.reason || fallback.reason }
  validateAndRecordDecision(room, wolf, 'wolf_chat', decision)
  return { ...decision, source: result.source, error: result.error }
}

const decideSeerCheck = async (room, seer, mode, manualTarget = null) => {
  const checked = new Set((room.roleFiles.seer[seer.id]?.checks ?? []).map((check) => check.target))
  const fallbackTarget = manualTarget ?? legalFallbackTarget(room, seer, { exclude: [seer.id, ...checked] }) ?? legalFallbackTarget(room, seer, { exclude: [seer.id] })
  const fallback = { target: fallbackTarget, reason: `根据公开发言和未查验列表选择${fallbackTarget}号。` }
  if (!shouldCallModel(mode)) return { ...fallback, source: manualTarget ? 'manual' : 'local' }
  const result = await aiDecision(room, seer, 'seer_check', seerCheckPrompt, fallback)
  const target = normalizeTarget(room, result.parsed?.target, fallbackTarget, { exclude: [seer.id, ...checked] }) ?? normalizeTarget(room, result.parsed?.target, fallbackTarget, { exclude: [seer.id] })
  const decision = { target, reason: result.parsed?.reason || fallback.reason }
  validateAndRecordDecision(room, seer, 'seer_check', decision)
  return { ...decision, source: result.source, error: result.error }
}

const decideGuard = async (room, guard, mode, manualTarget = null) => {
  const guardFile = room.roleFiles.guard[guard.id]
  const exclude = [guardFile?.actions?.[guardFile.actions.length - 1]?.target].filter(Boolean)
  const fallbackTarget = manualTarget ?? legalFallbackTarget(room, guard, { exclude })
  const fallback = { target: fallbackTarget, reason: `避开上一晚守护对象，选择${fallbackTarget}号。` }
  if (!shouldCallModel(mode)) return { ...fallback, source: manualTarget ? 'manual' : 'local' }
  const result = await aiDecision(room, guard, 'guard_action', guardPrompt, fallback)
  const target = normalizeTarget(room, result.parsed?.target, fallbackTarget, { exclude })
  const decision = { target, reason: result.parsed?.reason || fallback.reason }
  validateAndRecordDecision(room, guard, 'guard_action', decision)
  return { ...decision, source: result.source, error: result.error }
}

const decideWitch = async (room, witch, mode, manual = null) => {
  const witchFile = room.roleFiles.witch[witch.id]
  const aliveCount = room.players.filter((player) => player.alive).length
  const poisonFallbackTarget = legalFallbackTarget(room, witch, { exclude: [witch.id] })
  const shouldPressurePoison = Boolean(witchFile?.hasPoison && poisonFallbackTarget && aliveCount <= 4)
  const fallback = manual ?? (shouldPressurePoison
    ? { action: 'poison', poisonTarget: poisonFallbackTarget, reason: `残局存活仅${aliveCount}人，毒药继续留到夜里收益下降，按当前公开怀疑位毒${poisonFallbackTarget}号抢轮次。` }
    : { action: 'none', poisonTarget: null, reason: '信息不足，暂不使用药水。' })
  if (!shouldCallModel(mode)) return { ...fallback, source: manual ? 'manual' : 'local' }
  const result = await aiDecision(room, witch, 'witch_action', witchPrompt(aliveCount), fallback)
  const action = ['save', 'poison', 'none'].includes(result.parsed?.action) ? result.parsed.action : fallback.action
  const poisonTarget = action === 'poison' ? normalizeTarget(room, result.parsed?.poisonTarget, fallback.poisonTarget, { exclude: [witch.id] }) : null
  const decision = { action, poisonTarget, reason: result.parsed?.reason || fallback.reason }
  validateAndRecordDecision(room, witch, 'witch_action', decision)
  return { ...decision, source: result.source, error: result.error }
}

const decideHunterShot = async (room, hunter, mode) => {
  const fallbackTarget = legalFallbackTarget(room, hunter, { exclude: [hunter.id] })
  const fallback = { target: fallbackTarget, reason: `猎人死亡后根据公开嫌疑选择${fallbackTarget}号。` }
  if (!fallbackTarget) return { target: null, reason: '没有可开枪目标。', source: 'local' }
  if (!shouldCallModel(mode)) return { ...fallback, source: 'local' }
  const result = await aiDecision(room, hunter, 'hunter_shot', hunterShotPrompt, fallback)
  const target = normalizeTarget(room, result.parsed?.target, fallbackTarget, { exclude: [hunter.id] })
  const decision = { target, reason: result.parsed?.reason || fallback.reason }
  validateAndRecordDecision(room, hunter, 'hunter_shot', decision)
  return { ...decision, source: result.source, error: result.error }
}

export { decideExileSpeech, decideGuard, decideHunterShot, decideSeerCheck, decideSheriffSpeech, decideSpeech, decideVote, decideWolfChat, decideWitch, recordAiUsage, sanitizePublicText, shouldCallModel }
