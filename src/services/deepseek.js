import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { API_BASE, IS_NATIVE, readStoredApiKey } from '../game/platform.js'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'

const directDeepSeekBody = ({ model, messages, thinking, temperature = 0.85 }) => ({
  model,
  messages,
  temperature,
  thinking: typeof thinking === 'string' ? { type: thinking } : thinking,
})

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return { raw: value }
  }
}

const errorTextFromPayload = (payload) => {
  const data = parseMaybeJson(payload)
  return data?.error?.message ?? data?.message ?? data?.raw ?? JSON.stringify(data).slice(0, 400)
}

const normalizeDeepSeekPayload = (payload) => {
  const data = parseMaybeJson(payload)
  const content = data?.choices?.[0]?.message?.content?.trim() ?? ''
  const reasoning = data?.choices?.[0]?.message?.reasoning_content ?? ''
  const finishReason = data?.choices?.[0]?.finish_reason
  if (!content) {
    const reason = finishReason ? `, finish_reason=${finishReason}` : ''
    const reasoningInfo = reasoning ? `, reasoning_len=${reasoning.length}` : ''
    const raw = data?.raw ? `, raw=${data.raw.slice(0, 160)}` : ''
    throw new Error(`DeepSeek returned empty content${reason}${reasoningInfo}${raw}`)
  }
  return {
    content,
    reasoning,
    finishReason,
    usage: data?.usage ?? null,
    model: data?.model ?? null,
  }
}

const callDeepSeekDirectNative = async ({ model, messages, thinking, apiKey, temperature }) => {
  const body = directDeepSeekBody({ model, messages, thinking, temperature })
  const response = await CapacitorHttp.post({
    url: DEEPSEEK_API_URL,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    data: JSON.stringify(body),
    responseType: 'json',
    connectTimeout: 30000,
    readTimeout: 120000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`native HTTP ${response.status}: ${errorTextFromPayload(response.data)}`)
  }
  return normalizeDeepSeekPayload(response.data)
}

const callDeepSeekDirectFetch = async ({ model, messages, thinking, apiKey, temperature }) => {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(directDeepSeekBody({ model, messages, thinking, temperature })),
  })
  const text = await response.text()
  const payload = parseMaybeJson(text)
  if (!response.ok) {
    throw new Error(`fetch HTTP ${response.status}: ${errorTextFromPayload(payload)}`)
  }
  return normalizeDeepSeekPayload(payload)
}

const requestCache = new Map()

const cacheKeyFor = ({ model, messages, thinking, temperature, meta }) => JSON.stringify({
  model,
  messages,
  thinking,
  temperature,
  kind: meta?.kind,
  playerId: meta?.playerId,
  day: meta?.day,
  step: meta?.step,
})

const remember = (key, value) => {
  requestCache.set(key, value)
  if (requestCache.size > 120) requestCache.delete(requestCache.keys().next().value)
  return value
}

const callDeepSeekDetailed = async ({ model, messages, thinking = 'enabled', meta = {}, apiKey = readStoredApiKey(), temperature = 0.65 }) => {
  const cacheKey = cacheKeyFor({ model, messages, thinking, temperature, meta })
  if (requestCache.has(cacheKey)) return { ...requestCache.get(cacheKey), localCacheHit: true }

  if (IS_NATIVE) {
    if (!apiKey.trim()) throw new Error('请先在右上角设置 DeepSeek API Key')
    try {
      return remember(cacheKey, await callDeepSeekDirectNative({ model, messages, thinking, apiKey, temperature }))
    } catch (nativeError) {
      try {
        return remember(cacheKey, await callDeepSeekDirectFetch({ model, messages, thinking, apiKey, temperature }))
      } catch (fetchError) {
        throw new Error(`DeepSeek直连失败；平台=${Capacitor.getPlatform()}；模型=${model}；原生=${nativeError.message}；fetch=${fetchError.message}`, {
          cause: fetchError,
        })
      }
    }
  }

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      thinking,
      meta,
    }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'DeepSeek request failed')
  const content = payload.content.trim()
  if (!content) {
    const reason = payload.finishReason ? `, finish_reason=${payload.finishReason}` : ''
    const reasoning = payload.reasoning ? `, reasoning_len=${payload.reasoning.length}` : ''
    throw new Error(`DeepSeek returned empty content${reason}${reasoning}`)
  }
  return remember(cacheKey, {
    content,
    reasoning: payload.reasoning ?? '',
    finishReason: payload.finishReason ?? null,
    usage: payload.usage ?? null,
    model: payload.model ?? model,
  })
}

const callDeepSeek = async (request) => {
  const result = await callDeepSeekDetailed(request)
  return result.content
}

const testDeepSeekConnection = async (apiKey) => {
  const content = await callDeepSeek({
    model: 'deepseek-v4-flash',
    apiKey,
    messages: [
      { role: 'system', content: '你只回复 OK。' },
      { role: 'user', content: '测试连接' },
    ],
    thinking: 'enabled',
    meta: { action: 'mobile-key-test' },
  })
  return content
}

export { callDeepSeek, callDeepSeekDetailed, testDeepSeekConnection }
