const room12 = {
  playerCount: 12,
  label: '12人局',
  roles: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager'],
  enabledRoles: {
    seer: true,
    witch: true,
    hunter: true,
    guard: true,
  },
  nightOrder: ['wolf_chat', 'wolf_kill_resolve', 'seer_check', 'guard_action', 'witch_action', 'day_announcement'],
}

export { room12 }
