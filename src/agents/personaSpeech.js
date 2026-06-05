const personaActionFor = (player) => {
  const id = player.persona?.id ?? ''
  const actions = {
    short_pressure: '短句点名，丢一个必须回应的问题，结尾给明确压力。',
    long_review: '按时间线复盘两处变化，用慢慢收紧的语气下结论。',
    question_probe: '连续追问一个关键前提，不急着定死，逼对方补逻辑。',
    vote_obsessed: '抓投票、跟票、分票或变票细节，把票型当线索但不当身份证明。',
    claim_pressure: '逼对方解释站边和身份关系，但不要要求公开真实夜间信息。',
    cautious_edge: '保留一条反面可能，先压疑点，不把话说死。',
    vote_mobilizer: '给出归票路线和下一轮观察点，但必须带自己的新增公开依据。',
    sarcastic_breaker: '拆一句可疑措辞，带一点讽刺，但不要用空泛标签。',
    confused_observer: '先装作没听明白，点出对方解释里的缺口，让对方自己补。',
    leader_route: '先给路线，再说明如果这轮错了下一轮怎么修正。',
    low_defense: '少铺垫，先解释自己被打的点，再反压一个最具体的矛盾。',
    risk_trade: '提出一个有风险的换视角方案，并说明收益和代价。',
    emotion_charge: '语气更急、更硬，抓一个听感不顺处正面压上去。',
    calm_deconstruct: '逐句拆前提、证据和结论，指出偷换概念。',
    god_protector: '攻击找神、逼技能或要求夜间信息解释的行为，保护身份空间。',
    fake_neutral: '表面两边都盘，实际给一个更想投的方向，保留回旋。',
    last_summary: '后置归纳前面两人的分歧，再给自己的落点。',
    detail_picker: '抓一个关键词、顺序或口误，不扩大成铁证。',
    fast_alignment: '快速站边，但补一句如果公开信息变化会改票的条件。',
    reverse_bluff: '用半真半假的公开试探逼反应，不能越过私密边界。',
    memory_compare: '引用对方上一轮和这一轮的差别，抓前后不一致。',
    alliance_builder: '说明自己和谁的公开视角暂时一致，再划出对立面。',
    lone_independent: '明确挑战主流焦点，给一个被忽略位置或反证。',
    identity_lowkey: '压低自己身份表达，只谈公共逻辑和身份暴露风险。',
  }
  return actions[id] ?? '用自然口语表达一个具体公开矛盾，避免模板化复盘。'
}

const speechVoiceFor = (player) => {
  const id = player.persona?.id ?? ''
  const voices = {
    short_pressure: '少铺垫、短句、直接逼回答',
    long_review: '按顺序复盘，慢慢收紧',
    question_probe: '多问一句为什么，让对方补前提',
    vote_obsessed: '自然提到投票流向，但别把票当翻牌',
    claim_pressure: '压站边、压身份关系，不问夜间细节',
    cautious_edge: '保留余地，用“先挂着”“我不打死”这类口吻',
    vote_mobilizer: '像在组织票，但给修正路线',
    sarcastic_breaker: '可以带一点嘲讽，别堆术语',
    confused_observer: '表面困惑，实际逼人解释',
    leader_route: '像带队位，先给路线再给风险',
    low_defense: '先护住自己，再反压一个点',
    risk_trade: '敢提换视角和收益代价',
    emotion_charge: '情绪更重，句子更硬',
    calm_deconstruct: '冷静拆前提，不吵',
    god_protector: '关注谁在逼神、找技能、抢解释权',
    fake_neutral: '两边都说，但落点要偏一边',
    last_summary: '后置总结多人分歧',
    detail_picker: '抓顺序、关键词、口误',
    fast_alignment: '快速站边，给改票条件',
    reverse_bluff: '可以诈一下，试对方反应',
    memory_compare: '对照上一轮和这一轮',
    alliance_builder: '先找临时同视角，再划对立面',
    lone_independent: '挑战热门焦点或找冷门位',
    identity_lowkey: '少谈自己身份，谈暴露风险',
  }
  return voices[id] ?? '自然、具体、有玩家口吻'
}

const naturalFallbackText = (player, target = player.focusSuspicion?.target, label = '发言') => {
  const focus = target ?? '这个位置'
  const prefix = `${player.id}号${label}：`
  const id = player.persona?.id ?? ''
  const templates = {
    short_pressure: `${prefix}${focus}号先别躲，我只问一件事：你现在认谁是好人，谁进狼坑？别绕，给一个能落票的答案。`,
    long_review: `${prefix}我按顺序说。前面最关键的不是某一句话，而是谁一直在推同一个方向、谁又不肯补完整狼坑。${focus}号这里我先挂着。`,
    question_probe: `${prefix}${focus}号你解释一下，你怀疑人的前提是哪一段公开发言？如果这个前提站不住，后面那套归票就太顺了。`,
    vote_obsessed: `${prefix}我先看票和站边的配合。${focus}号前面说法能不能和后面的投票方向对上，这是我现在最在意的。`,
    claim_pressure: `${prefix}${focus}号别只说谁像狼，你得说你认哪条身份线，保谁、踩谁。站边不交代清楚，我就先压你。`,
    cautious_edge: `${prefix}我不把${focus}号直接打死，但他现在解释不够完整。先挂疑，等他补站边和狼坑。`,
    leader_route: `${prefix}路线先放这：今天听${focus}号补坑，补不出来就进主线；补得出来，再回头看推动他的人。`,
    low_defense: `${prefix}我先说明，我不接受空泛听感压人。${focus}号的问题更具体：站边、保人和投票理由没扣上。`,
    risk_trade: `${prefix}我提个换视角：先别顺着热门位冲，看看${focus}号被谁保、被谁踩。这个信息量更大。`,
    emotion_charge: `${prefix}我真不想再听空话了。${focus}号要么把狼坑点清楚，要么今天就别怪我压上去。`,
    calm_deconstruct: `${prefix}拆开看，${focus}号的证据和结论中间差了一步。能解释，我放一放；解释不了，我投这里。`,
    lone_independent: `${prefix}我不急着跟热门票。${focus}号当然要听，但我更想看有没有人借这个焦点藏在后面。`,
  }
  return templates[id] ?? `${prefix}我先压${focus}号，重点听他怎么交代站边、保踩关系和投票理由。`
}

export { naturalFallbackText, personaActionFor, speechVoiceFor }
