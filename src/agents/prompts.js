import { legalTargets } from '../game/utils.js'
import { personaActionFor, speechVoiceFor } from './personaSpeech.js'

const AI_SYSTEM_PREFIX = [
  '你正在参与一局狼人杀。只能依据本次提供的文件行动，不得编造未记录的信息。',
  '规则由独立的 rules/game_rules.json system 消息提供，视为稳定缓存上下文。',
  '动态文件包只包含本次行动可读文件：public.json、自己的 private.json、自己的 model_context.json，以及身份允许的角色文件。',
  'model_context.json 中 knownFacts 才能当事实；publicClaims 只能当公开说法；unknowns 禁止脑补；legalAction 优先于策略和风格。',
  '公开发言允许跳身份、诈身份、报查验、反诈和强势站边；不要因为边界限制退化成安全模板。',
  '放逐结果、全票、多数票、死亡、遗言都不能直接证明身份；只能作为线索。',
  '平安夜不影响预言家查验结果；不能用无死讯否定查验，也不能把平安夜本身当作查杀时机可疑。',
  '跟随热门归票时必须给自己的公开依据，不能只说“大家都这么说”。',
  '输出前在 JSON 的 factCheck 中自检事实边界；factCheck 不给玩家看。',
  '只输出合法 JSON，不要 Markdown，不要解释 JSON 外内容。',
].join('\n')

const RULES_CACHE_MESSAGE = [
  '--- rules_summary ---',
  '狼人达到人数优势胜；好人放逐全部狼人胜。',
  '预言家每夜查一人，只知是否狼人。女巫一晚不能同时救和毒；守卫不能连续守同一人；猎人被夜杀/放逐可开枪，被毒/枪杀不可开枪。',
  '公开死亡不翻牌；公开身份、查验、用药说法未验证前只是说法。',
].join('\n')

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

const consensusPressureForPrompt = (room, player) => {
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
  const top = ranked[0] ?? null
  const challengeStyles = ['lone_independent', 'question_probe', 'calm_deconstruct', 'detail_picker', 'cautious_edge', 'fake_neutral', 'memory_compare']
  const shouldChallenge = challengeStyles.includes(player.persona?.id ?? '')
  return shouldChallenge
    ? `当前热门焦点是${top?.target ?? '无'}号。你的风格适合找反证、替代嫌疑或被忽略位置；如果同意热门，也要讲出你自己看到的公开矛盾。`
    : `当前热门焦点是${top?.target ?? '无'}号。可以同意热门，但先给自己的公开依据；不要复读“前面都说过”。`
}

const roleSpeechGuidance = (room, player) => {
  if (player.role !== 'seer') return ''
  const checks = room.roleFiles.seer[player.id]?.checks ?? []
  const wolfChecks = checks.filter((check) => check.result === 'wolf')
  if (wolfChecks.length) {
    return `你是预言家，已有查杀：${wolfChecks.map((check) => `${check.target}号`).join('、')}。公开发言阶段应清楚报验人和夜次，不要拖到投票理由才首次报验。`
  }
  if (checks.length) return `你是预言家，已有查验：${checks.map((check) => `${check.target}号${check.result === 'wolf' ? '狼人' : '不是狼人'}`).join('、')}。可按局势报验，但不要编造未查验信息。`
  return ''
}

const publicSpeechPrompt = (label, room, player) => [
  `任务：生成${label}公开发言，并给出当前最怀疑对象 focusSuspicion。`,
  `反跟风：${consensusPressureForPrompt(room, player)}`,
  `角色口吻：${speechVoiceFor(player)}。`,
  `本轮打法：${personaActionFor(player)}`,
  roleSpeechGuidance(room, player),
  '内部同时检查：身份说法、保踩关系、票路收益；公开 content 用自然话说，别照抄内部字段名。',
  '自然表达：谁跳了什么、认哪边、谁保谁踩、谁跟票分票、狼坑好人坑怎么摆。',
  '公开 content 要像玩家在桌上说话：可以追问、反压、站边、归票、留边、讽刺、急躁或保守；不要像审计报告，不要每段都列“第一第二第三”。',
  '至少引用两个公开依据，但用自然句子融合进去；可以短促，也可以复盘，取决于 persona。',
  '避免模板句和术语堆叠，尤其别反复用“行为变形、转向缺少独立依据、提前布局抗推位”。',
  'JSON {"content":"...","reasoningCheck":{"roleLine":"...","sideLine":"...","voteLine":"...","evidence":["...","..."],"inference":"...","counterpoint":"..."},"styleMove":"追问|拆词|反压|留边|归票|挑战主流|保护身份空间|换视角","catchphrase":"...","claimsMade":[{"type":"suspicion|claim|vote_plan","targetId":数字,"basis":"public_speech|vote|death|public_claim|self_claim|explicit_contradiction|role_line|side_line|vote_line"}],"focusSuspicion":{"target":数字,"reason":"..."},"consensusPosition":"agree_with_new_evidence|challenge_consensus|alternate_target|hold","factCheck":["..."]}',
].filter(Boolean).join('\n')

const votePrompt = (room, player) => [
  `反跟风：${consensusPressureForPrompt(room, player)}`,
  `投票口吻：${speechVoiceFor(player)}。`,
  `本轮打法：${personaActionFor(player)}`,
  '公开投票。理由写给全场看，可以伪装动机，但不能直接暴露私有文件、狼队友、刀口、救人/毒人对象或夜聊原文。',
  '不能投自己，不能自爆式认错或牺牲自己来解决逻辑压力；狼人也要像正常玩家一样投可抗推目标。',
  '内部检查身份说法、保踩关系、票路收益；reason 用自然话说，别照抄内部字段名。',
  '投票理由要自然落到至少两类信息：身份/站边、保踩关系、票路收益。不能只说某一句话怪。',
  '如果 target 是热门焦点，reason 必须有你自己的新增公开依据；如果没有，优先投替代目标或说明为什么挑战主流。',
  'JSON {"target":数字,"reason":"...","reasoningCheck":{"roleLine":"...","sideLine":"...","voteLine":"...","evidence":["...","..."],"inference":"...","counterpoint":"..."},"styleMove":"追问|拆词|反压|留边|归票|挑战主流|保护身份空间|换视角","consensusPosition":"agree_with_new_evidence|challenge_consensus|alternate_target","independentEvidence":"...","factCheck":["..."]}',
].join('\n')

const exileSpeechPrompt = [
  '你被白天投票放逐，现在发表公开出局发言。可以诈身份或伪装，但不能直接暴露私有文件、狼队友、刀口、救人/毒人对象或夜聊原文。',
  '自然提醒大家复盘站边、保踩关系和投票流向，不说内部字段名。',
  '格式 {"content":"...","focusSuspicion":{"target":数字,"reason":"一句中文理由"}}',
].join('\n')

const wolfChatPrompt = [
  '狼队夜聊，发言并给出建议刀口。控制在 120-180 字，最多三点：神职/威胁判断、抗推收益、最终刀口。',
  '狼人私下已知非队友属于好人阵营，重点推理谁像预言家、女巫、守卫、猎人或高威胁民；理由应包含神职/威胁/抗推价值，而不是怀疑对方是狼。',
  '狼队允许自刀狼人做身份。',
  '格式 {"content":"...","killTarget":数字,"reason":"..."}',
].join('\n')

const seerCheckPrompt = '预言家夜晚查验。格式 {"target":数字,"reason":"..."}'
const guardPrompt = '守卫选择守护目标，不能连续两晚守同一人。格式 {"target":数字,"reason":"..."}'
const hunterShotPrompt = '猎人死亡后选择是否开枪带人。格式 {"target":数字,"reason":"一句中文理由"}'

const witchPrompt = (aliveCount) => `女巫行动，一晚不能同时救和毒。小残局（存活${aliveCount}人，4人或更少）且毒药还在时，默认应主动考虑毒当前公开最高嫌疑位抢轮次；只有目标不合法、会明显毒到已坐实好人，或解药救人更关键时才选择 none。格式 {"action":"save|poison|none","poisonTarget":数字或null,"reason":"..."}`

const fallbackVoteReason = (target) => `${target}号现在站边和保踩关系没交代清楚，我先投这里看票路怎么走。`

const legalFallbackTarget = (room, player, options = {}) => {
  const candidates = legalTargets(room, options)
  const current = player?.focusSuspicion?.target
  return candidates.find((candidate) => candidate.id === current)?.id ?? candidates[0]?.id ?? null
}

export {
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
}
