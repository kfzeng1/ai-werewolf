const room9 = {
  playerCount: 9,
  label: '9人局',
  roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
  enabledRoles: {
    seer: true,
    witch: true,
    hunter: true,
    guard: false,
  },
  nightOrder: ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'witch_action', 'day_announcement'],
}

export { room9 }
