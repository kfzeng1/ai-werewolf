import { legalTargets } from '../game/utils.js'

const clip = (value, max = 180) => String(value ?? '').slice(0, max)

const HIDDEN_LEAK_PATTERNS = [
  /(我的|我那?个|我们|咱们).{0,8}(狼队友|狼同伴)/,
  /我们狼队/,
  /我们狼人/,
  /(^|[，。；：:\s])我是狼人(?!杀)/,
  /(^|[，。；：:\s])我是狼(?!人杀)/,
  /我作为狼人/,
  /我的狼队/,
  /狼队夜聊/,
  /保护(我的|我们|咱们)?狼队友/,
  /混淆好人视线/,
  /不暴露团队/,
  /昨晚我们刀了/,
  /我们.{0,12}(刀口|安排刀|选择刀|决定刀|刀了)/,
  /收到.{0,10}刀口信息/,
  /刀口信息/,
  /报.{0,6}刀口/,
  /救人信息/,
  /救了谁/,
  /女巫.{0,12}(毒|毒了|毒杀)\d+号/,
  /我.{0,8}(毒|毒了|毒杀)\d+号/,
  /\d+号是我毒的/,
  /我毒的\d+号/,
  /我.{0,12}救(的是|了)?\d+号/,
  /刀口是\d+号/,
  /刀口在\d+号/,
  /女巫.{0,20}(没开药|没救|未救|不用药).{0,30}刀口/,
  /我.{0,20}(解药|救药).{0,20}\d+号/,
  /女巫.{0,20}(救|解药).{0,20}\d+号/,
]

const UNSUPPORTED_FACT_PATTERNS = [
  { type: 'unsupported_public_certainty', pattern: /被放逐.*(证实|坐实|验明).*(狼人|好人|狼|民|神)/ },
  { type: 'unsupported_public_certainty', pattern: /(全票|多数票|票型|被放逐|放逐结果|出局).{0,20}(证明|证实|坐实|验明).{0,20}(身份不干净|身份有问题|身份偏脏)/ },
  { type: 'unsupported_public_certainty', pattern: /(已|已经)?(被)?(证实|坐实|验明).*(狼人|好人|狼|民|神)/ },
  { type: 'unsupported_public_certainty', pattern: /出局.*(证明|证实|坐实).*(狼人|好人|狼|民|神)/ },
  { type: 'unsupported_public_certainty', pattern: /救了?\d+号.*所以.*(好人|金水|不是狼)/ },
  { type: 'unsupported_public_certainty', pattern: /刀口.*所以.*(好人|金水|不是狼)/ },
  { type: 'seer_check_rule_misread', pattern: /(平安夜|没有死讯|无死讯|零死讯).{0,40}(查验|预言家|查杀).{0,40}(无依据|没依据|没有信息支撑|立不住|真实性存疑|无法证明)/ },
  { type: 'seer_check_timing_misread', pattern: /(平安夜|没有死讯|无死讯|零死讯).{0,30}(直接|急着|起跳|发查杀|给.*查杀).{0,35}(时机|可疑|难信|不可信|赌|冒险|风险)/ },
  { type: 'witch_save_timing_misread', pattern: /(女巫|解药|3号死亡|昨夜死亡).{0,50}(没救|未救|没动|不用药).{0,80}(平安夜|后一晚|后面|才救|救人).{0,50}(矛盾|不合理|刻意|可疑|时间线)/ },
  { type: 'unrevealed_death_as_wolf_proof', pattern: /(出局|被放逐|死亡|已死|倒牌).{0,30}(验证|坐实|实锤).{0,20}(狼面|狼性|狼人|铁狼|狼坑)/ },
  { type: 'vote_result_as_role_proof', pattern: /(票型|全票|多数票|被放逐).{0,30}(证明|证实|坐实).{0,30}(悍跳|真预言家|假预言家|狼人|好人|狼|民|神)/ },
  { type: 'unrevealed_death_as_role_proof', pattern: /\d+号.{0,8}(死了|死亡|被刀|出局).{0,16}(所以|说明|证明|坐实).{0,16}(真预言家|真神|好人|狼人|狼|民|神)/ },
  { type: 'night_death_over_inference', pattern: /(夜里|昨夜|晚上).{0,20}\d+号死亡.{0,30}说明.{0,20}狼队不在\d+号/ },
  { type: 'hunter_exile_as_verification', pattern: /(出|放逐|投)\d+号.{0,12}验证.{0,8}(猎人|身份)/ },
  { type: 'last_words_overweighted', pattern: /遗言.{0,20}(明确|已经)?(关注|指向|咬|踩)\d+号.{0,20}(两条线索|共同|都|一起).{0,12}(指向|打到)\d+号/ },
  { type: 'weak_single_axis_reasoning', pattern: /(只凭|单凭|就凭|光凭).{0,20}(后置跳|没上警|不竞选|金水反打|狼踩狼|票型|死亡|遗言).{0,20}(出|投|归票|打死|坐实)/ },
  { type: 'overused_template_phrase', pattern: /(转向缺少独立依据|行为变形|提前布局抗推|逻辑断层|避重就轻).{0,28}(转向缺少独立依据|行为变形|提前布局抗推|逻辑断层|避重就轻)/ },
]

const STRUCTURED_REASONING_WEAK_BASIS = new Set([
  'death',
  'vote',
  'public_claim',
  'single_phrase',
  'consensus',
  'last_words',
])

const CHAIN_BASIS = new Set(['identity_chain', 'alignment_chain', 'vote_chain', 'role_line', 'side_line', 'vote_line'])

const hasMeaningfulFactCheck = (factCheck) => Array.isArray(factCheck)
  && factCheck.some((item) => /(事实|公开说法|推理|不能|未公开|边界|只说明|不证明)/.test(String(item)))

const playerPublicTexts = (room, id) => [
  ...(room?.publicFile?.speeches ?? []),
  ...(room?.publicFile?.lastWords ?? []),
].filter((item) => Number(item.playerId) === Number(id)).map((item) => String(item.content ?? ''))

const hasPublicClaim = (room, id, pattern) => playerPublicTexts(room, id).some((content) => pattern.test(content))

const validateStructuredReasoning = (decision) => {
  const violations = []
  const claims = Array.isArray(decision?.claimsMade) ? decision.claimsMade : []
  const suspicions = claims.filter((claim) => ['suspicion', 'vote_plan'].includes(claim?.type))
  const basis = suspicions.map((claim) => String(claim?.basis ?? ''))
  if (suspicions.length && basis.length && basis.every((item) => STRUCTURED_REASONING_WEAK_BASIS.has(item))) {
    violations.push(violation('weak_structured_reasoning', basis.join(','), 'medium', '至少补一个 public_speech 或 explicit_contradiction 类型公开依据。'))
  }
  const independentEvidence = String(decision?.independentEvidence ?? decision?.focusSuspicion?.reason ?? '').trim()
  if (decision?.consensusPosition === 'agree_with_new_evidence' && (!independentEvidence || /(大家都|多数人|前面|跟票|主流|票型已经)/.test(independentEvidence))) {
    violations.push(violation('missing_independent_evidence', 'consensusPosition', 'medium', '跟随主流时必须提供自己的新增公开依据。'))
  }
  if (!hasMeaningfulFactCheck(decision?.factCheck)) {
    violations.push(violation('missing_fact_boundary_check', 'factCheck', 'medium', 'factCheck 必须区分事实、公开说法和推理。'))
  }
  if (decision?.styleMove && !['追问', '拆词', '反压', '留边', '归票', '挑战主流', '保护身份空间', '换视角'].includes(decision.styleMove)) {
    violations.push(violation('invalid_style_move', decision.styleMove, 'low', 'styleMove 必须来自允许枚举。'))
  }
  const chainText = [
    decision?.reasoningCheck?.roleLine,
    decision?.reasoningCheck?.sideLine,
    decision?.reasoningCheck?.voteLine,
    decision?.reasoningCheck?.identityChain,
    decision?.reasoningCheck?.alignmentChain,
    decision?.reasoningCheck?.voteChain,
    decision?.focusSuspicion?.reason,
    decision?.reason,
    decision?.content,
  ].map((item) => String(item ?? '')).join('\n')
  const chainBasisCount = new Set(basis.filter((item) => CHAIN_BASIS.has(item))).size
  const chainTextCount = [
    /身份链|身份线|身份|站边|跳|查验|神|民/.test(chainText),
    /阵营链|阵营线|同边|互保|互踩|保|踩|狼坑|好人坑/.test(chainText),
    /票型链|票路|票型|投票|跟票|分票|归票|变票/.test(chainText),
  ].filter(Boolean).length
  if ((decision?.content || decision?.reason) && chainBasisCount + chainTextCount < 2) {
    violations.push(violation('missing_chain_reasoning', 'role/side/vote lines', 'medium', '公开发言/投票至少落到身份说法、保踩关系、票路中的两条。'))
  }
  return violations
}

const violation = (type, span, severity = 'medium', repairHint = '') => ({
  type,
  span: clip(span),
  severity,
  repairHint,
})

const validatePublicText = (room, text) => {
  const value = String(text ?? '')
  const violations = []
  for (const pattern of HIDDEN_LEAK_PATTERNS) {
    const match = value.match(pattern)
    if (match) violations.push(violation('hidden_private_leak', match[0], 'high', '整段回退为仅基于公开信息的发言。'))
  }
  for (const { type, pattern } of UNSUPPORTED_FACT_PATTERNS) {
    const match = value.match(pattern)
    if (match) violations.push(violation(type, match[0], 'medium', '改写为公开线索或未公开身份边界。'))
  }
  for (const dead of room?.players?.filter((player) => !player.alive && !player.publicRoleRevealed) ?? []) {
    const roleAsFact = new RegExp(`${dead.id}号(狼人|好人|平民|预言家|女巫|猎人|守卫|狼|民|神)遗言|${dead.id}号(已|已经)?(是|为)(狼人|好人|平民|预言家|女巫|猎人|守卫|狼|民|神)|${dead.id}号(狼人|好人|平民|预言家|女巫|猎人|守卫|狼|民|神)(已|已经)?出局`)
    const match = value.match(roleAsFact)
    if (match) violations.push(violation('unrevealed_dead_role_as_fact', match[0], 'medium', `${dead.id}号只能说已出局，身份未公开。`))
    const unsupportedDeadRoleClaim = new RegExp(`${dead.id}号.{0,18}(自称|跳|起跳|认)(了)?(预言家|女巫|猎人|守卫)`)
    const claimMatch = value.match(unsupportedDeadRoleClaim)
    if (claimMatch && !hasPublicClaim(room, dead.id, /预言家|女巫|猎人|守卫|查验|解药|毒药|开枪|守护/)) {
      violations.push(violation('unsupported_dead_role_claim_reference', claimMatch[0], 'medium', `${dead.id}号生前身份说法没有公开记录支撑。`))
    }
  }
  return { valid: violations.length === 0, violations }
}

const validateDecision = (room, player, kind, decision = {}) => {
  const violations = []
  const checkTarget = (field, options = {}) => {
    const target = Number(decision[field])
    if (!Number.isFinite(target)) return
    const legal = legalTargets(room, options).map((item) => item.id)
    if (!legal.includes(target)) {
      violations.push(violation('illegal_target', `${field}:${decision[field]}`, 'high', `合法目标：${legal.join(',') || 'none'}`))
    }
  }

  if (['day_speech', 'sheriff_speech', 'exile_speech'].includes(kind)) {
    violations.push(...validatePublicText(room, decision.content).violations)
  }
  if (kind === 'day_vote') {
    checkTarget('target')
    violations.push(...validatePublicText(room, decision.reason).violations)
  }
  if (['day_speech', 'sheriff_speech', 'day_vote'].includes(kind)) {
    violations.push(...validateStructuredReasoning(decision))
  }
  if (kind === 'wolf_chat') checkTarget('killTarget')
  if (kind === 'seer_check') checkTarget('target', { exclude: [player.id] })
  if (kind === 'guard_action') {
    const cannotRepeat = room.roleFiles.guard[player.id]?.currentNight?.cannotRepeatTarget
    checkTarget('target', { exclude: [cannotRepeat].filter(Boolean) })
  }
  if (kind === 'witch_action' && decision.action === 'poison') checkTarget('poisonTarget', { exclude: [player.id] })
  if (kind === 'hunter_shot') checkTarget('target', { exclude: [player.id] })

  return { valid: violations.length === 0, violations }
}

export { HIDDEN_LEAK_PATTERNS, UNSUPPORTED_FACT_PATTERNS, validateDecision, validatePublicText }
