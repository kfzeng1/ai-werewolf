const room6 = {
  playerCount: 6,
  label: '6人局',
  roles: ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager'],
  enabledRoles: {
    seer: true,
    witch: true,
    hunter: false,
    guard: false,
  },
  nightOrder: ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'witch_action', 'day_announcement'],
}

export { room6 }
