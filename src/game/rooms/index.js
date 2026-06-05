import { room6 } from './room6.js'
import { room9 } from './room9.js'
import { room12 } from './room12.js'

const ROOM_RULES = {
  6: room6,
  9: room9,
  12: room12,
}

const ROOM_PRESETS = Object.fromEntries(
  Object.entries(ROOM_RULES).map(([count, rules]) => [count, { label: rules.label, roles: rules.roles }]),
)

const getRoomRules = (playerCount = 9) => ROOM_RULES[playerCount] ?? room9

export { ROOM_PRESETS, ROOM_RULES, getRoomRules }
