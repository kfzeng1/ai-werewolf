const HISTORY_KEY = 'ai-werewolf.history.v1'
const MAX_HISTORY = 30

const readHistory = () => {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const writeHistory = (items) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
}

const createHistoryRecord = (room) => ({
  id: room.id,
  savedAt: new Date().toISOString(),
  preset: room.preset,
  playerCount: room.players.length,
  day: room.day,
  winner: room.winner,
  winnerLabel: room.winner === 'wolf' ? '狼队' : '好人',
  review: room.review,
  players: room.players.map((player) => ({
    id: player.id,
    role: player.role,
    roleLabel: player.roleLabel,
    team: player.team,
    alive: player.alive,
    persona: player.persona,
    reasoningState: player.reasoningState,
  })),
  timeline: room.godView.timeline.map((event) => ({
    id: event.id,
    day: event.day,
    phase: event.phase,
    step: event.step,
    visibility: event.visibility,
    type: event.type,
    actor: event.actor,
    content: event.content,
  })),
})

const saveHistoryRecord = (room) => {
  if (!room?.id || room.status !== 'finished' || !room.winner) return []
  const record = createHistoryRecord(room)
  const existing = readHistory().filter((item) => item.id !== record.id)
  const next = [record, ...existing]
  writeHistory(next)
  return next
}

const clearHistory = () => writeHistory([])

export { clearHistory, readHistory, saveHistoryRecord }
