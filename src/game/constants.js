const ROLE_LABELS = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  villager: '平民',
}

const TEAM_LABELS = { wolf: '狼队', good: '好人' }

const PERSONA_STYLES = [
  { id: 'short_pressure', name: '短句强压型', languageStyle: '短句、直接点名、少铺垫，语气有压迫感。', thinkingStyle: '先锁焦点位，再逼对方解释站边、票型和动机。', conflictStyle: '主动施压，逼人回应，不怕正面对抗。', voteStyle: '倾向快速归票，不喜欢分票。', claimStyle: '被压才交身份，平时用公开逻辑压人。', roleFit: ['werewolf', 'hunter', 'villager'] },
  { id: 'long_review', name: '长线复盘型', languageStyle: '长句、按时间线复盘，喜欢列前后矛盾。', thinkingStyle: '看发言、票型、死亡顺序是否一致。', conflictStyle: '不急着压人，用逻辑慢慢收紧。', voteStyle: '投行为链条最不自洽的人。', claimStyle: '先讲证据，再决定是否亮身份。', roleFit: ['villager', 'seer', 'guard'] },
  { id: 'question_probe', name: '反问试探型', languageStyle: '反问多，经常抛问题，语气带试探。', thinkingStyle: '通过别人回应质量判断身份。', conflictStyle: '先逼补逻辑，再看反应定性。', voteStyle: '投回答含糊、转移问题的人。', claimStyle: '用半公开问题试身份，不轻易摊牌。', roleFit: ['villager', 'werewolf', 'witch'] },
  { id: 'vote_obsessed', name: '票型执念型', languageStyle: '频繁引用谁投谁、谁跟票、谁分票。', thinkingStyle: '认为票型比发言更真实。', conflictStyle: '抓跟票、冲票、弃票、变票。', voteStyle: '优先投票型异常位。', claimStyle: '身份信息服务于票型判断。', roleFit: ['villager', 'hunter', 'werewolf'] },
  { id: 'claim_pressure', name: '身份压迫型', languageStyle: '经常要求站边、交身份、解释技能逻辑。', thinkingStyle: '通过身份链和对跳关系找狼。', conflictStyle: '强逼身份，制造压力。', voteStyle: '优先出身份逻辑冲突的人。', claimStyle: '主动逼别人表态，自己可早跳或诈跳。', roleFit: ['seer', 'witch', 'werewolf'] },
  { id: 'cautious_edge', name: '谨慎留边型', languageStyle: '保留判断，少用绝对词，语气克制。', thinkingStyle: '信息不足时先观察，不急着定狼。', conflictStyle: '避免强冲突，但会指出疑点。', voteStyle: '跟随更完整的公共逻辑。', claimStyle: '不到关键轮次不轻易亮身份。', roleFit: ['villager', 'guard', 'witch'] },
  { id: 'vote_mobilizer', name: '煽动归票型', languageStyle: '强势号召，反复强调统一票型。', thinkingStyle: '通过多数压力推进目标。', conflictStyle: '主动带节奏，放大焦点。', voteStyle: '早给归票方向，要求别人跟票。', claimStyle: '可用身份或警徽制造归票权威。', roleFit: ['werewolf', 'seer', 'villager'] },
  { id: 'sarcastic_breaker', name: '阴阳拆台型', languageStyle: '带讽刺，质疑动机，抓措辞。', thinkingStyle: '从别人为什么这么说入手。', conflictStyle: '拆表演感、过度解释和前后不一。', voteStyle: '投发言用力过猛或动机不纯的人。', claimStyle: '不急着亮身份，先拆别人身份。', roleFit: ['werewolf', 'villager', 'hunter'] },
  { id: 'confused_observer', name: '装糊涂观察型', languageStyle: '表面不确定，经常要求别人补充解释。', thinkingStyle: '故意让别人解释，看谁急着拉站边。', conflictStyle: '被动反问，不主动开团。', voteStyle: '后置投票，观察谁来拉票。', claimStyle: '尽量隐藏身份，靠反应判断。', roleFit: ['werewolf', 'villager', 'guard'] },
  { id: 'leader_route', name: '强势带队型', languageStyle: '结论明确，喜欢给路线和下一轮安排。', thinkingStyle: '先建立主线，再处理反对者。', conflictStyle: '压制摇摆位，逼人站队。', voteStyle: '投主线最大狼坑。', claimStyle: '可主动亮身份控场。', roleFit: ['seer', 'hunter', 'werewolf'] },
  { id: 'low_defense', name: '低调防守型', languageStyle: '话不多，重点解释自己，不主动铺太长。', thinkingStyle: '先保护自己不进焦点，再慢慢找疑点。', conflictStyle: '少主动打人，多回应质疑。', voteStyle: '跟随多数，但给简短理由。', claimStyle: '被压才交身份。', roleFit: ['villager', 'guard', 'werewolf'] },
  { id: 'risk_trade', name: '风险博弈型', languageStyle: '喜欢提出大胆方案和换视角打法。', thinkingStyle: '愿意用一轮投票换信息。', conflictStyle: '挑战常规逻辑，制造变量。', voteStyle: '投能最大化信息量的位置。', claimStyle: '可主动诈身份试反应。', roleFit: ['witch', 'hunter', 'werewolf'] },
  { id: 'emotion_charge', name: '情绪冲锋型', languageStyle: '情绪强烈，容易急，压迫感明显。', thinkingStyle: '凭听感和反应速度快速判断。', conflictStyle: '正面硬刚，不怕对跳。', voteStyle: '投当轮最不顺耳的人。', claimStyle: '被质疑时强硬自证。', roleFit: ['werewolf', 'hunter', 'villager'] },
  { id: 'calm_deconstruct', name: '冷静拆解型', languageStyle: '平稳理性，逐句拆逻辑，少情绪。', thinkingStyle: '找论证漏洞、前提错误和偷换概念。', conflictStyle: '不吵架，但持续追问漏洞。', voteStyle: '投逻辑漏洞最大的人。', claimStyle: '身份服务于逻辑闭环。', roleFit: ['villager', 'seer', 'guard'] },
  { id: 'god_protector', name: '保护神职型', languageStyle: '关注神职安全、身份暴露风险和找神行为。', thinkingStyle: '优先判断谁在逼神、找技能牌。', conflictStyle: '攻击过度逼身份的人。', voteStyle: '投疑似找神、冲神的人。', claimStyle: '保护真神，必要时挡刀或混淆。', roleFit: ['villager', 'guard', 'witch'] },
  { id: 'fake_neutral', name: '假装中立型', languageStyle: '表面客观，两边都盘，留回旋空间。', thinkingStyle: '不站死，观察风向和压力位。', conflictStyle: '避免正面冲突，做平衡发言。', voteStyle: '看形势跟票，理由偏中庸。', claimStyle: '身份表达模糊，保留余地。', roleFit: ['werewolf', 'villager'] },
  { id: 'last_summary', name: '末置归纳型', languageStyle: '总结前面所有人的发言后再定性。', thinkingStyle: '从多人发言关系里找共同矛盾。', conflictStyle: '后置定性，容易一锤定音。', voteStyle: '投被多人逻辑共同指向的人。', claimStyle: '用归纳结果决定是否亮身份。', roleFit: ['villager', 'seer', 'werewolf'] },
  { id: 'detail_picker', name: '细节抓错型', languageStyle: '抓关键词、口误、顺序和措辞。', thinkingStyle: '认为小错误能暴露视角。', conflictStyle: '持续追一个细节不放。', voteStyle: '投解释不清细节的人。', claimStyle: '通过细节逼身份。', roleFit: ['villager', 'hunter', 'werewolf'] },
  { id: 'fast_alignment', name: '快速站边型', languageStyle: '很快给出站边，不喜欢摇摆。', thinkingStyle: '先认一个主视角，再沿着主视角盘人。', conflictStyle: '攻击不站边或反复横跳的人。', voteStyle: '跟认可的预言家、警长或强势位。', claimStyle: '身份表达跟随主视角。', roleFit: ['villager', 'werewolf', 'seer'] },
  { id: 'reverse_bluff', name: '反逻辑诈身份型', languageStyle: '故意说半真半假，引别人反应。', thinkingStyle: '用错误诱导别人暴露视角。', conflictStyle: '制造混乱和对跳压力。', voteStyle: '投对试探反应最大的人。', claimStyle: '主动诈身份，但不越过私密边界。', roleFit: ['werewolf', 'hunter', 'witch'] },
  { id: 'memory_compare', name: '记忆对照型', languageStyle: '经常引用你上一轮怎么说。', thinkingStyle: '对比玩家前后发言是否变形。', conflictStyle: '抓变票、变站边、变理由。', voteStyle: '投前后不一致的人。', claimStyle: '把身份说法纳入前后对照。', roleFit: ['villager', 'seer', 'hunter'] },
  { id: 'alliance_builder', name: '抱团站边型', languageStyle: '强调我和谁视角一致，拉同盟。', thinkingStyle: '通过阵营关系找同盟和对立面。', conflictStyle: '排斥反对阵营，保护同视角。', voteStyle: '跟同视角玩家集中投票。', claimStyle: '用身份说法构建阵营。', roleFit: ['werewolf', 'villager'] },
  { id: 'lone_independent', name: '孤立独立型', languageStyle: '不爱跟多数，强调独立判断。', thinkingStyle: '反向看热门焦点，怀疑带队者。', conflictStyle: '挑战主流归票。', voteStyle: '容易投冷门位。', claimStyle: '不轻易按别人身份链站边。', roleFit: ['villager', 'werewolf', 'hunter'] },
  { id: 'identity_lowkey', name: '压低身份型', languageStyle: '少谈自己身份，多谈公共逻辑。', thinkingStyle: '避免暴露技能或真实视角。', conflictStyle: '不主动跳，被压才解释。', voteStyle: '投最能保护身份空间的位置。', claimStyle: '藏身份优先，关键轮才摊牌。', roleFit: ['witch', 'guard', 'seer', 'werewolf'] },
]

const STEP_LABELS = {
  setup: '开局准备', manual_setup: '开局设置', sheriff_speech: '警长竞选发言', sheriff_election: '警长选择', day_speech: '白天发言', day_vote: '公开投票', exile: '放逐结算', exile_speech: '出局发言', wolf_chat: '狼队夜聊', wolf_kill_resolve: '狼刀统计', seer_check: '预言家查验', guard_action: '守卫守护', witch_action: '女巫行动', day_announcement: '天亮播报', sheriff_badge: '警徽处理', review: '主持复盘',
}

const AUTO_SPEEDS = [{ label: '0.5x', value: 2400 }, { label: '1x', value: 1400 }, { label: '2x', value: 760 }]
const MODEL_PRICES_PER_MILLION = {
  'deepseek-v4-flash': { cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 },
}

const WIN_CONDITIONS = {
  werewolf: '帮助狼人阵营达成人数优势胜利。',
  villager: '帮助好人阵营放逐所有狼人。',
  seer: '帮助好人阵营放逐所有狼人，并利用查验信息推动归票。',
  witch: '帮助好人阵营放逐所有狼人，并合理使用解药和毒药。',
  guard: '帮助好人阵营放逐所有狼人，并通过守护减少夜间死亡。',
  hunter: '帮助好人阵营放逐所有狼人，死亡可开枪时带走最高狼面目标。',
}

const GAME_RULES = {
  version: 1,
  speechBoundary: '公开发言、警上发言、出局发言、投票理由可以诈身份、悍跳、隐藏身份、伪装逻辑，但不能直接泄露私有文件、狼队文件或夜间密谋原文。',
  wolf: {
    selfKillAllowed: true,
    nightChat: '狼人夜间逐个发言并给出建议刀口，最终按建议多数或随机确定刀口。',
    publicPlay: '狼人公开环节应像其他玩家一样用公开逻辑发言，可以伪装身份。',
  },
  seer: {
    checkResultScope: '预言家每夜查验一名玩家，只知道结果是否为狼人。',
  },
  witch: {
    saveKnowledge: '女巫看到并救起的是狼队刀口，不能因此确定该玩家阵营；狼人允许自刀。',
    medicine: '女巫一晚不能同时使用解药和毒药。解药用完后不再获得刀口信息。',
  },
  guard: {
    noConsecutiveSameTarget: true,
    saveInteraction: '守卫守中刀口时防止夜杀；守卫和女巫同救同一刀口不额外导致死亡。',
  },
  hunter: {
    canShootOnDeath: '猎人被夜杀或放逐时可以开枪；被毒或被猎人带走时不能开枪。',
  },
  sheriff: {
    electionByUser: true,
    badgeAfterDeath: '警长死亡后由用户决定递交警徽或撕毁。',
  },
  victory: {
    wolf: '狼人数量大于或等于好人数量时狼队胜利。',
    good: '所有狼人出局时好人胜利。',
  },
}

export { AUTO_SPEEDS, GAME_RULES, MODEL_PRICES_PER_MILLION, PERSONA_STYLES, ROLE_LABELS, STEP_LABELS, TEAM_LABELS, WIN_CONDITIONS }
