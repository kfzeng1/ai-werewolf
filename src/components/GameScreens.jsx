import { useState } from 'react'
import { ArrowLeft, ChevronsDown, Crosshair, Flag, FlaskConical, Moon, Play, RefreshCcw, ScrollText, Shield, Sparkles, Sprout, Users, X } from 'lucide-react'
import { AUTO_SPEEDS, MODEL_PROVIDERS, ROLE_LABELS, ROOM_PRESETS, STEP_LABELS, alivePlayers } from '../game/engine.js'
import avatarGuard from '../assets/role-avatars/guard.png'
import avatarHunter from '../assets/role-avatars/hunter.png'
import avatarSeer from '../assets/role-avatars/seer.png'
import avatarVillager from '../assets/role-avatars/villager.png'
import avatarWerewolf from '../assets/role-avatars/werewolf.png'
import avatarWitch from '../assets/role-avatars/witch.png'

const ROLE_META = {
  werewolf: { icon: Moon, avatar: avatarWerewolf, title: '夜间协同刀人', detail: '狼人可读取狼队文件，夜晚依次发言并给出刀口建议。目标是让狼人数量达到或超过好人。' },
  seer: { icon: Sparkles, avatar: avatarSeer, title: '每夜查验阵营', detail: '预言家拥有查验记录文件，每次记录目标、理由、结果，只知道是否为狼人。' },
  witch: { icon: FlaskConical, avatar: avatarWitch, title: '解药与毒药', detail: '女巫文件记录药水状态。解药用完后不再获得刀口信息，毒药和解药不能同夜同时使用。' },
  hunter: { icon: Crosshair, avatar: avatarHunter, title: '死亡后可开枪', detail: '猎人在被夜杀或放逐时可开枪，公共文件会记录猎人亮枪和带走目标。' },
  guard: { icon: Shield, avatar: avatarGuard, title: '夜晚守护', detail: '守卫每夜选择守护目标，记录在专属文件中，不能连续两晚守护同一人。' },
  villager: { icon: Sprout, avatar: avatarVillager, title: '无夜间技能', detail: '平民只读取公共文件和个人私有文件，通过发言、票型和公共事件判断狼人。' },
}

const splitSeats = (players) => {
  const midpoint = Math.ceil(players.length / 2)
  return [players.slice(0, midpoint), players.slice(midpoint)]
}

const formatUsd = (value) => `$${Number(value || 0).toFixed(6)}`
const formatSavedAt = (value) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const personaLabel = (player) => player?.persona?.name ?? '自然平衡型'
const teamLabel = (team) => team === 'wolf' ? '狼队' : team === 'good' ? '好人' : '未知'
const roleLabel = (role) => role && role !== 'unknown' ? (ROLE_LABELS[role] ?? role) : '未知'
const alignmentLabel = (value) => ({
  suspected_wolf: '疑似狼',
  known_good_target: '已知好人目标',
  teammate: '狼队友',
  unknown: '未知',
}[value] ?? value ?? '未知')

const summarizeAiCost = (calls = []) => calls.reduce((summary, call) => {
  const usage = call.usage ?? {}
  return {
    calls: summary.calls + 1,
    estimatedUsd: summary.estimatedUsd + (call.estimatedUsd ?? 0),
    prompt: summary.prompt + (usage.prompt ?? 0),
    cached: summary.cached + (usage.cached ?? 0),
    cacheMiss: summary.cacheMiss + (usage.cacheMiss ?? 0),
    completion: summary.completion + (usage.completion ?? 0),
    reasoning: summary.reasoning + (usage.reasoning ?? 0),
    localCacheHits: summary.localCacheHits + (call.localCacheHit ? 1 : 0),
  }
}, { calls: 0, estimatedUsd: 0, prompt: 0, cached: 0, cacheMiss: 0, completion: 0, reasoning: 0, localCacheHits: 0 })

function RoleAvatar({ player, selected }) {
  const Icon = ROLE_META[player.role]?.icon ?? Users
  const avatar = ROLE_META[player.role]?.avatar
  return (
    <span className={`avatar-ring role-${player.role} ${selected ? 'selected' : ''} ${!player.alive ? 'dead' : ''}`}>
      {avatar ? <img src={avatar} alt="" /> : <Icon size={22} />}
      <em>{player.id}</em>
    </span>
  )
}

function CostPanel({ calls, fallbacks = [] }) {
  const summary = summarizeAiCost(calls)
  const recent = calls.slice(-4).reverse()
  const recentFallbacks = fallbacks.slice(-3).reverse()
  return (
    <section className="cost-panel" aria-label="AI token 成本">
      <div className="cost-head">
        <span>AI 成本估算</span>
        <strong>{formatUsd(summary.estimatedUsd)}</strong>
        <em>{summary.calls} 次调用 · 本地缓存 {summary.localCacheHits} · 兜底 {fallbacks.length}</em>
      </div>
      <dl>
        <div><dt>Prompt</dt><dd>{summary.prompt}</dd></div>
        <div><dt>Cache Hit</dt><dd>{summary.cached}</dd></div>
        <div><dt>Cache Miss</dt><dd>{summary.cacheMiss}</dd></div>
        <div><dt>Completion</dt><dd>{summary.completion}</dd></div>
        <div><dt>Reasoning</dt><dd>{summary.reasoning}</dd></div>
      </dl>
      <div className="cost-recent">
        {recent.length ? recent.map((call) => (
          <span key={call.id}>
            {call.kind}{call.playerId ? ` · ${call.playerId}号` : ''}{call.attempt > 1 ? ` · retry${call.attempt - 1}` : ''} · {MODEL_PROVIDERS[call.provider]?.label ?? call.provider ?? 'AI'} · {String(call.model).replace('deepseek-v4-', '')} · {call.finishReason || 'stop'} · {formatUsd(call.estimatedUsd)}
          </span>
        )) : <span>AI 模式调用后显示 token 与费用。</span>}
        {recentFallbacks.map((item) => (
          <span key={item.id} className="fallback-row">
            兜底 · {item.kind}{item.playerId ? ` · ${item.playerId}号` : ''}{item.attempt > 1 ? ` · retry${item.attempt - 1}` : ''} · {item.error}
          </span>
        ))}
      </div>
    </section>
  )
}

function IdentityReadPanel({ room, selected }) {
  const privateFile = room.files?.[`players/${selected.id}/private.json`]
  const rows = privateFile?.identityBoard ?? []

  return (
    <section className="identity-reads" aria-label={`${selected.id}号身份推理`}>
      <div className="identity-reads-title">
        <strong>身份推理</strong>
        <span>{selected.id}号视角 · 实时私有文件</span>
      </div>
      <div className="identity-read-list">
        {rows.map((item) => {
          const known = item.known ?? {}
          const read = item.read
          const locked = Boolean(known.locked && known.role !== 'unknown')
          const knownText = `${teamLabel(known.team)} / ${roleLabel(known.role)}`
          const readText = read ? `${alignmentLabel(read.alignment)} / ${roleLabel(read.role)} · ${read.roleConfidence}` : '已锁定'
          return (
            <article key={item.playerId} className={`identity-read-row ${locked ? 'locked' : ''}`}>
              <div className="identity-read-seat">
                <strong>{item.playerId}号</strong>
                <span>{item.publicStatus === 'dead' ? '出局' : '存活'}</span>
              </div>
              <div>
                <dt>已知</dt>
                <dd>{knownText}</dd>
                <small>{known.source === 'none' ? '暂无事实' : known.source}{known.note ? ` · ${known.note}` : ''}</small>
              </div>
              <div>
                <dt>推理</dt>
                <dd>{readText}</dd>
                <small>{read ? `${read.actionPriority} · ${read.threatLevel} · ${read.reason}` : '不可改事实'}</small>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function IdentityReadDialog({ room, selected, onClose }) {
  if (!selected) return null
  return (
    <section className="identity-overlay" role="dialog" aria-modal="true" aria-label={`${selected.id}号身份推理`}>
      <div className="identity-dialog">
        <header>
          <div>
            <p className="eyebrow">{selected.id}号 · {selected.roleLabel}</p>
            <h2>身份推理</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭身份推理"><X size={18} /></button>
        </header>
        <IdentityReadPanel room={room} selected={selected} />
      </div>
    </section>
  )
}

function SeatColumn({ players, selectedId, onSelect }) {
  return (
    <aside className="seat-column">
      {players.map((player) => (
        <button key={player.id} type="button" className={`seat role-${player.role} ${selectedId === player.id ? 'selected' : ''} ${!player.alive ? 'dead' : ''}`} onClick={() => onSelect(player.id)}>
          <RoleAvatar player={player} selected={selectedId === player.id} />
          <strong>{player.roleLabel}</strong>
          <small>{player.alive ? personaLabel(player) : '出局'}</small>
          {player.publicRoleRevealed && <em>{ROLE_LABELS[player.publicRoleRevealed]}</em>}
        </button>
      ))}
    </aside>
  )
}

function SetupSelect({ label, value, options, onChange, disabledIds = [] }) {
  return (
    <label className="setup-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((player) => (
          <option key={player.id} value={player.id} disabled={disabledIds.includes(player.id)}>
            {player.id}号 · {player.roleLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function SelectScreen({ historyCount, onCreate, onHistory }) {
  return (
    <main className="entry-shell">
      <section className="entry-panel">
        <p className="eyebrow">AI Werewolf</p>
        <h1>开一桌</h1>
        <div className="preset-grid">
          {Object.entries(ROOM_PRESETS).map(([count, preset]) => (
            <button key={count} type="button" onClick={() => onCreate(Number(count))}>
              <Users size={20} />
              <strong>{preset.label}</strong>
              <span>{preset.roles.length} 名 AI 玩家</span>
            </button>
          ))}
        </div>
        <button type="button" className="history-entry" onClick={onHistory}>
          <ScrollText size={18} />
          历史对局
          <span>{historyCount} 局</span>
        </button>
      </section>
    </main>
  )
}

function ReviewContent({ content }) {
  let structured = null
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    if (parsed && typeof parsed === 'object' && parsed.summary) structured = parsed
  } catch {
    structured = null
  }
  if (structured) {
    const sections = [
      ['关键转折', structured.turningPoints],
      ['好人阵营', structured.goodSide],
      ['狼人阵营', structured.wolfSide],
      ['关键失误', structured.keyMistakes],
      ['主持人备注', structured.hostNotes],
    ].filter(([, items]) => Array.isArray(items) && items.length)
    return (
      <div className="review-content structured-review">
        <section className="review-hero">
          <span>{structured.result}</span>
          <h3>{structured.title || '主持人复盘'}</h3>
          <p>{structured.summary}</p>
        </section>
        <div className="review-section-grid">
          {sections.map(([title, items]) => (
            <section key={title} className="review-section">
              <h3>{title}</h3>
              {items.map((item, index) => <p key={`${title}-${index}`}>{item}</p>)}
            </section>
          ))}
        </div>
      </div>
    )
  }
  const lines = String(content || '暂无复盘内容。').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return (
    <div className="review-content">
      {lines.map((line, index) => {
        const normalized = line.replace(/^\*\*(.+)\*\*$/, '$1')
        if (line.startsWith('# ')) return <h2 key={index}>{line.replace(/^#\s+/, '')}</h2>
        if (line.startsWith('## ')) return <h3 key={index}>{line.replace(/^##\s+/, '')}</h3>
        if (/^【.+】$/.test(normalized)) return <h3 key={index}>{normalized}</h3>
        if (/^[-*]\s+/.test(line)) return <p key={index} className="review-bullet">{line.replace(/^[-*]\s+/, '')}</p>
        return <p key={index}>{normalized}</p>
      })}
    </div>
  )
}

function HistoryScreen({ history, selectedHistoryId, setSelectedHistoryId, onBack, onClear }) {
  const selected = history.find((item) => item.id === selectedHistoryId) ?? history[0]
  return (
    <main className="history-shell">
      <header className="prep-header">
        <div>
          <p className="eyebrow">Local Records</p>
          <h1>历史对局</h1>
        </div>
        <div className="page-actions">
          <button type="button" onClick={onBack}><ArrowLeft size={18} />返回</button>
          <button type="button" onClick={onClear} disabled={!history.length}><X size={18} />清空</button>
        </div>
      </header>
      {!selected ? (
        <section className="empty-history">暂无历史对局。游戏结束后会自动保存到本地浏览器。</section>
      ) : (
        <section className="history-grid">
          <aside className="history-list">
            {history.map((item) => (
              <button key={item.id} type="button" className={selected.id === item.id ? 'selected' : ''} onClick={() => setSelectedHistoryId(item.id)}>
                <strong>{item.preset} · {item.winnerLabel}胜利</strong>
                <span>{formatSavedAt(item.savedAt)} · 第{item.day}天</span>
              </button>
            ))}
          </aside>
          <section className="history-detail">
            <div className="history-summary">
              <strong>{selected.preset} · {selected.winnerLabel}胜利</strong>
              <span>{formatSavedAt(selected.savedAt)}</span>
            </div>
            <div className="history-players">
              {selected.players.map((player) => (
                <span key={player.id} className={`role-${player.role}`}>{player.id}号 {player.roleLabel}{player.alive ? '' : ' · 出局'}</span>
              ))}
            </div>
            <ReviewContent content={selected.review} />
            <div className="history-timeline">
              {selected.timeline.slice(-30).map((event) => (
                <article key={event.id} className={`timeline-event ${event.visibility}`}>
                  <span><b>{event.actor}</b><em>{STEP_LABELS[event.step] ?? event.step}</em></span>
                  <p>{event.content}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}
    </main>
  )
}

function PrepScreen({ room, setup, setSetup, onBack, onRefresh, onStart }) {
  const wolves = room.players.filter((player) => player.role === 'werewolf')
  const seer = room.players.find((player) => player.role === 'seer')
  const witch = room.players.find((player) => player.role === 'witch')
  const guard = room.players.find((player) => player.role === 'guard')
  const candidates = new Set(setup.sheriffCandidates)
  const update = (patch) => setSetup((value) => ({ ...value, ...patch }))

  const toggleCandidate = (id) => {
    const next = new Set(candidates)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const list = [...next]
    update({ sheriffCandidates: list.length ? list : [id] })
  }

  return (
    <main className="prep-shell">
      <header className="prep-header">
        <div>
          <p className="eyebrow">开局准备 · {room.preset}</p>
          <h1>设置第一夜与警长</h1>
        </div>
        <div className="page-actions">
          <button type="button" onClick={onBack}><ArrowLeft size={18} />返回</button>
          <button type="button" onClick={onRefresh}><RefreshCcw size={18} />刷新配置</button>
          <button type="button" className="primary" onClick={onStart}><Play size={18} />开始观战</button>
        </div>
      </header>

      <section className="identity-board">
        {room.players.map((player) => (
          <article key={player.id} className={`identity-card role-${player.role}`}>
            <span>{player.id}号</span>
            <strong>{player.roleLabel}</strong>
            <small>{personaLabel(player)}</small>
          </article>
        ))}
      </section>

      <section className="setup-grid">
        <div className="setup-block">
          <h2><Moon size={18} />第一夜行动</h2>
          <SetupSelect label="狼队首刀" value={setup.wolfKillTarget} options={room.players} onChange={(wolfKillTarget) => update({ wolfKillTarget })} />
          {seer && <SetupSelect label={`${seer.id}号预言家查验`} value={setup.seerCheckTarget} options={room.players.filter((player) => player.id !== seer.id)} onChange={(seerCheckTarget) => update({ seerCheckTarget })} />}
          {guard && <SetupSelect label={`${guard.id}号守卫守护`} value={setup.guardTarget} options={room.players} onChange={(guardTarget) => update({ guardTarget })} />}
          {witch && (
            <label className="setup-field">
              <span>{witch.id}号女巫行动</span>
              <select value={setup.witchAction} onChange={(event) => update({ witchAction: event.target.value })}>
                <option value="none">不用药</option>
                <option value="save">救人</option>
                <option value="poison">毒人</option>
              </select>
            </label>
          )}
          {witch && setup.witchAction === 'poison' && <SetupSelect label="女巫毒药目标" value={setup.witchPoisonTarget} options={room.players.filter((player) => player.id !== witch.id)} onChange={(witchPoisonTarget) => update({ witchPoisonTarget })} />}
        </div>

        <div className="setup-block">
          <h2><Flag size={18} />上警人选</h2>
          <div className="candidate-list">
            {room.players.map((player) => (
              <label key={player.id}>
                <input type="checkbox" checked={candidates.has(player.id)} onChange={() => toggleCandidate(player.id)} />
                {player.id}号
              </label>
            ))}
          </div>
          <p className="hint">这里只选择参与竞选的玩家。进入对局后会按顺序警上发言，发言结束后由用户选择警长。</p>
        </div>
      </section>

      <section className="wolf-note">
        <strong>狼队成员：</strong>{wolves.map((wolf) => `${wolf.id}号`).join('、')}
      </section>
    </main>
  )
}

function MobileSeatRail({ players, selectedId, onSelect }) {
  return (
    <nav className="mobile-seat-rail" aria-label="玩家座位">
      {players.map((player) => (
        <button key={player.id} type="button" className={`mobile-seat role-${player.role} ${selectedId === player.id ? 'selected' : ''} ${!player.alive ? 'dead' : ''}`} onClick={() => onSelect(player.id)}>
          <RoleAvatar player={player} selected={selectedId === player.id} />
          <span>{player.id}号</span>
        </button>
      ))}
    </nav>
  )
}

function PlayScreen({ room, selectedId, setSelectedId, auto, setAuto, speed, setSpeed, advancing, showReview, setShowReview, onBack, onStep, onReset, onSheriff, onSheriffElection }) {
  const [identityModalId, setIdentityModalId] = useState(null)
  const [left, right] = splitSeats(room.players)
  const selected = room.players.find((player) => player.id === selectedId) ?? room.players[0]
  const identitySelected = room.players.find((player) => player.id === identityModalId) ?? null
  const selectedMeta = ROLE_META[selected.role] ?? ROLE_META.villager
  const SelectedIcon = selectedMeta.icon
  const aiCalls = room.godView?.debug?.aiCalls ?? []
  const aiFallbacks = room.godView?.debug?.aiFallbacks ?? []
  const transferTargets = alivePlayers(room).filter((player) => player.id !== room.pendingSheriffDecision?.from)
  const sheriffCandidates = room.publicFile.sheriff.candidates
    .map((id) => room.players.find((player) => player.id === id))
    .filter((player) => player?.alive)
  const openIdentity = (id) => {
    setSelectedId(id)
    setIdentityModalId(id)
  }

  return (
    <main className="table-shell">
      <header className="table-header">
        <div>
          <p className="eyebrow">第{room.day}天 · {STEP_LABELS[room.currentStep?.type] ?? '等待'}</p>
          <h1>{room.status === 'finished' ? '对局结束' : room.preset}</h1>
        </div>
        <div className="top-controls">
          <span className="model-pill">DeepSeek</span>
          <select value={speed.label} onChange={(event) => setSpeed(AUTO_SPEEDS.find((item) => item.label === event.target.value))}>{AUTO_SPEEDS.map((item) => <option key={item.label}>{item.label}</option>)}</select>
          <button type="button" onClick={onBack} disabled={advancing}><ArrowLeft size={16} />返回准备</button>
          <button type="button" onClick={() => setShowReview(true)} disabled={!room.review}><ScrollText size={16} />复盘</button>
          <button type="button" onClick={() => setAuto((value) => !value)} disabled={room.status === 'finished'}>{auto ? '暂停' : '自动'}</button>
          <button type="button" className="primary" onClick={onStep} disabled={advancing || auto || room.status === 'finished' || room.pendingSheriffElection || room.pendingSheriffDecision}>{advancing ? '执行中' : '下一步'}</button>
          <button type="button" onClick={onReset} aria-label="新局"><RefreshCcw size={16} /></button>
        </div>
      </header>

      <section className="table-status-strip" aria-label="对局状态">
        <span>存活 {alivePlayers(room).length}/{room.players.length}</span>
        <span>警长 {room.publicFile.sheriff.id ? `${room.publicFile.sheriff.id}号` : '无'}</span>
        <span>{MODEL_PROVIDERS[room.modelProvider]?.label ?? room.modelProvider}</span>
        <span>调用 {aiCalls.length}</span>
      </section>

      <CostPanel calls={aiCalls} fallbacks={aiFallbacks} />

      {room.pendingSheriffDecision && (
        <section className="sheriff-decision">
          <strong>{room.pendingSheriffDecision.from}号警长死亡，处理警徽</strong>
          <div>
            {transferTargets.map((player) => <button key={player.id} type="button" onClick={() => onSheriff({ type: 'transfer', target: player.id })}>递交给{player.id}号</button>)}
            <button type="button" onClick={() => onSheriff({ type: 'destroy' })}>撕毁警徽</button>
          </div>
        </section>
      )}

      {room.pendingSheriffElection && (
        <section className="sheriff-decision">
          <strong>警长竞选发言结束，选择警长</strong>
          <div>
            {sheriffCandidates.map((player) => <button key={player.id} type="button" onClick={() => onSheriffElection({ target: player.id })}>选择{player.id}号</button>)}
          </div>
        </section>
      )}

      <MobileSeatRail players={room.players} selectedId={selectedId} onSelect={openIdentity} />

      <section className="table-grid">
        <div className="desktop-seat-column"><SeatColumn players={left} selectedId={selectedId} onSelect={openIdentity} /></div>
        <section className="timeline-panel">
          <div className="selected-file">
            <RoleAvatar player={selected} selected />
            <div><strong>{selected.id}号 · {selected.roleLabel}</strong><span>{personaLabel(selected)}</span></div>
          </div>
          <section className={`role-inspector role-${selected.role}`}>
            <div className="role-inspector-title">
              <SelectedIcon size={18} />
              <strong>{selectedMeta.title}</strong>
            </div>
            <p>{selectedMeta.detail}</p>
            <dl>
              <div><dt>阵营</dt><dd>{selected.team === 'wolf' ? '狼队' : '好人'}</dd></div>
              <div><dt>模型</dt><dd>{selected.model}</dd></div>
              <div><dt>状态</dt><dd>{selected.alive ? '存活' : '出局'}</dd></div>
            </dl>
          </section>
          <div className="timeline-feed">
            {room.godView.timeline.map((event) => (
              <article key={event.id} className={`timeline-event ${event.visibility}`}>
                <span><b>{event.actor}</b><em>{STEP_LABELS[event.step] ?? event.step}</em></span>
                <p>{event.content}</p>
              </article>
            ))}
          </div>
          <div className="scroll-hint"><ChevronsDown size={16} />时间线向下追加</div>
        </section>
        <div className="desktop-seat-column"><SeatColumn players={right} selectedId={selectedId} onSelect={openIdentity} /></div>
      </section>

      <nav className="mobile-action-bar" aria-label="对局操作">
        <button type="button" onClick={() => setAuto((value) => !value)} disabled={room.status === 'finished'}>{auto ? '暂停' : '自动'}</button>
        <button type="button" className="primary" onClick={onStep} disabled={advancing || auto || room.status === 'finished' || room.pendingSheriffElection || room.pendingSheriffDecision}>{advancing ? '执行中' : '下一步'}</button>
        <button type="button" onClick={() => setShowReview(true)} disabled={!room.review}><ScrollText size={16} />复盘</button>
      </nav>

      <IdentityReadDialog room={room} selected={identitySelected} onClose={() => setIdentityModalId(null)} />

      {showReview && (
        <section className="review-overlay" role="dialog" aria-modal="true" aria-label="主持人复盘">
          <div className="review-dialog">
            <header>
              <div>
                <p className="eyebrow">Host Review</p>
                <h2>主持人复盘</h2>
              </div>
              <button type="button" onClick={() => setShowReview(false)} aria-label="关闭复盘"><X size={18} /></button>
            </header>
            <ReviewContent content={room.review} />
          </div>
        </section>
      )}
    </main>
  )
}

function ExitConfirmDialog({ onCancel, onConfirm }) {
  return (
    <section className="confirm-overlay" role="dialog" aria-modal="true" aria-label="结束当前游戏">
      <div className="confirm-dialog">
        <p className="eyebrow">Game In Progress</p>
        <h2>结束当前游戏？</h2>
        <p>当前对局还在进行中，结束后不会保存到历史记录。</p>
        <div>
          <button type="button" onClick={onCancel}>继续游戏</button>
          <button type="button" className="danger" onClick={onConfirm}>结束本局</button>
        </div>
      </div>
    </section>
  )
}

export { ExitConfirmDialog, HistoryScreen, PlayScreen, PrepScreen, SelectScreen }
