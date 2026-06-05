import { expect, test } from '@playwright/test'

const startRoom = async (page, label = /6人局/) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible()
  await page.getByRole('button', { name: label }).click()
  await expect(page.getByRole('heading', { name: '设置第一夜与警长' })).toBeVisible()
  await page.getByRole('button', { name: /开始/ }).click()
}

test('web flow creates a room and reaches the DeepSeek spectator table', async ({ page }) => {
  await startRoom(page, /9人局/)

  await expect(page.getByRole('heading', { name: '9人局' })).toBeVisible()
  await expect(page.locator('.model-pill')).toHaveText('DeepSeek')
  await expect(page.locator('.seat')).toHaveCount(9)
  await expect(page.locator('.timeline-event')).not.toHaveCount(0)
  await expect(page.getByText('时间线向下追加')).toBeVisible()
})

test('prep refresh, back navigation, and active game exit confirmation work', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /9人局/ }).click()
  await expect(page.getByRole('heading', { name: '设置第一夜与警长' })).toBeVisible()
  const before = await page.locator('.identity-card').first().textContent()

  await page.getByRole('button', { name: /刷新配置/ }).click()
  await expect.poll(async () => page.locator('.identity-card').first().textContent()).not.toBe(before)

  await page.getByRole('button', { name: /^返回$/ }).click()
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible()

  await page.getByRole('button', { name: /9人局/ }).click()
  await page.getByRole('button', { name: /开始/ }).click()
  await expect(page.getByRole('heading', { name: '9人局' })).toBeVisible()
  await page.getByRole('button', { name: /返回准备/ }).click()
  await expect(page.getByRole('dialog', { name: '结束当前游戏' })).toBeVisible()
  await page.getByRole('button', { name: '继续游戏' }).click()
  await expect(page.getByRole('heading', { name: '9人局' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '结束当前游戏' })).not.toBeVisible()
  await page.getByRole('button', { name: /返回准备/ }).click()
  await page.getByRole('button', { name: '结束本局' }).click()
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible()
})

test('mobile layout exposes seat rail, status strip, and bottom actions without browser errors', async ({ page }) => {
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })

  await startRoom(page, /6人局/)

  await expect(page.locator('.mobile-seat-rail')).toBeVisible()
  await expect(page.locator('.mobile-action-bar')).toBeVisible()
  await expect(page.getByText('存活 6/6')).toBeVisible()
  await expect(page.locator('.top-controls').getByText('DeepSeek')).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('12 player room renders desktop spectator table without browser errors', async ({ page }) => {
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await startRoom(page, /12人局/)

  await expect(page.getByRole('heading', { name: '12人局' })).toBeVisible()
  await expect(page.locator('.seat')).toHaveCount(12)
  await expect(page.locator('.desktop-seat-column').first()).toBeVisible()
  await expect(page.locator('.timeline-panel')).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('seeded local history can be reviewed and cleared', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.setItem('ai-werewolf.history.v1', JSON.stringify([{
      id: 'test-history',
      savedAt: new Date().toISOString(),
      preset: '6人局',
      playerCount: 6,
      day: 3,
      winner: 'good',
      winnerLabel: '好人',
      review: JSON.stringify({
        title: '测试复盘',
        result: '好人胜利',
        summary: '好人通过公开发言和投票锁定最后狼人。',
        turningPoints: ['1号报验推动第一轮焦点。'],
        goodSide: ['好人最终归票正确。'],
        wolfSide: ['狼队未能扛住末轮压力。'],
        keyMistakes: ['末狼发言没有补齐票路解释。'],
        hostNotes: ['测试记录。'],
      }),
      players: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        role: index === 0 ? 'seer' : index < 2 ? 'werewolf' : 'villager',
        roleLabel: index === 0 ? '预言家' : index < 2 ? '狼人' : '平民',
        team: index < 2 ? 'wolf' : 'good',
        alive: index > 1,
        persona: { name: '测试风格' },
      })),
      timeline: [{ id: 'e1', day: 1, phase: 'day', step: 'day_speech', visibility: 'public', type: 'speech', actor: '1号', content: '测试时间线。' }],
    }]))
  })
  await page.reload()

  await page.getByRole('button', { name: /历史对局/ }).click()
  await expect(page.getByRole('heading', { name: '历史对局' })).toBeVisible()
  await expect(page.locator('.history-list button').first()).toContainText(/6人局 · 好人胜利/)
  await expect(page.locator('.history-players span')).toHaveCount(6)
  await expect(page.locator('.history-timeline .timeline-event')).not.toHaveCount(0)

  await page.getByRole('button', { name: /清空/ }).click()
  await expect(page.getByText('暂无历史对局。游戏结束后会自动保存到本地浏览器。')).toBeVisible()
})
