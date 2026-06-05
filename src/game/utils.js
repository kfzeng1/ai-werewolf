const clone = (value) => JSON.parse(JSON.stringify(value))
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const pick = (items) => items[Math.floor(Math.random() * items.length)]

const shuffle = (items) => {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

const roleTeam = (role) => (role === 'werewolf' ? 'wolf' : 'good')
const alivePlayers = (room) => room.players.filter((player) => player.alive)
const aliveWolves = (room) => room.players.filter((player) => player.alive && player.role === 'werewolf')
const playerById = (room, id) => room.players.find((player) => player.id === Number(id))
const rolePlayer = (room, role) => room.players.find((player) => player.role === role && player.alive)

const legalTargets = (room, { exclude = [], teamNot = null } = {}) => alivePlayers(room)
  .filter((player) => !exclude.includes(player.id) && (!teamNot || player.team !== teamNot))

const legalTargetId = (room, target, options = {}) => {
  const id = Number(String(target).match(/\d+/)?.[0])
  return legalTargets(room, options).some((player) => player.id === id) ? id : null
}

const fallbackTarget = (room, target, options = {}) => legalTargetId(room, target, options) ?? pick(legalTargets(room, options))?.id ?? null

const normalizeTarget = (room, target, fallback, options = {}) => {
  const id = Number(String(target).match(/\d+/)?.[0])
  const legal = legalTargets(room, options).map((player) => player.id)
  return legal.includes(id) ? id : legal.includes(Number(fallback)) ? Number(fallback) : null
}

const parseJsonObject = (raw) => {
  const match = String(raw).match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

export { alivePlayers, aliveWolves, clone, createId, fallbackTarget, legalTargetId, legalTargets, normalizeTarget, parseJsonObject, pick, playerById, rolePlayer, roleTeam, shuffle }
