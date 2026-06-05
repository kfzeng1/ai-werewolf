import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.DEEPSEEK_PROXY_PORT || 8787)
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const PRIMARY_MODEL = process.env.PRIMARY_API_MODEL || null
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY_PATH = process.env.DEEPSEEK_KEY_PATH || path.join(ROOT_DIR, 'key.txt')
const LOG_DIR = path.join(ROOT_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'deepseek-proxy.jsonl')

fs.mkdirSync(LOG_DIR, { recursive: true })

const writeLog = (entry) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
  fs.appendFile(LOG_FILE, `${line}\n`, () => {})
  console.log(line)
}

const promptSummary = (messages = []) => ({
  count: messages.length,
  roles: messages.map((message) => message.role),
  chars: messages.reduce((sum, message) => sum + String(message.content || '').length, 0),
})

const readKey = () => {
  const raw = fs.readFileSync(KEY_PATH, 'utf8')
  return parseKey(raw, /DEEPSEEK_API_KEY\s*=\s*["']?([^"'\s]+)["']?/i)
}

const parseKey = (raw, envPattern) => {
  const envMatch = raw.match(envPattern)
  if (envMatch) return envMatch[1]
  const skMatch = raw.match(/sk-[A-Za-z0-9_-]+/)
  if (skMatch) return skMatch[0]
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  return lines.at(-1)
}

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body ? JSON.parse(body) : {}))
    req.on('error', reject)
  })

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  if (req.method === 'GET' && req.url === '/api/status') {
    try {
      const key = readKey()
      return send(res, 200, {
        ok: Boolean(key),
        keyPath: KEY_PATH,
        baseUrl: BASE_URL,
        primaryModel: PRIMARY_MODEL,
        keyPreview: key ? `${key.slice(0, 3)}***${key.slice(-4)}` : null,
      })
    } catch (error) {
      return send(res, 500, { ok: false, error: error.message })
    }
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return send(res, 404, { ok: false, error: 'Not found' })
  }

  try {
    const startedAt = Date.now()
    const { model = 'deepseek-v4-flash', messages, temperature = 0.8, thinking = 'enabled', meta = {} } = await readBody(req)
    if (!Array.isArray(messages) || messages.length === 0) {
      writeLog({ type: 'validation_error', route: '/api/chat', error: 'messages is required' })
      return send(res, 400, { ok: false, error: 'messages is required' })
    }

    const primaryModel = PRIMARY_MODEL || model
    const requestBody = {
      model: primaryModel,
      messages,
      temperature,
      stream: false,
      thinking: { type: thinking },
    }
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readKey()}`,
      },
      body: JSON.stringify(requestBody),
    })

    const payload = await response.json().catch(() => ({}))
    const message = payload.choices?.[0]?.message || {}
    const content = message.content || ''
    const reasoning = message.reasoning_content || ''
    const finishReason = payload.choices?.[0]?.finish_reason
    const logBase = {
      type: 'chat_completion',
      model: primaryModel,
      requestedModel: model,
      thinking,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      finishReason,
      contentLength: content.trim().length,
      reasoningLength: reasoning.trim().length,
      usage: payload.usage,
      prompt: promptSummary(messages),
      meta,
    }
    if (!response.ok) {
      const primaryError = payload.error?.message || response.statusText
      writeLog({
        ...logBase,
        error: primaryError,
      })
      return send(res, response.status, {
        ok: false,
        error: primaryError,
        detail: payload,
      })
    }

    writeLog(logBase)
    return send(res, 200, {
      ok: true,
      model: payload.model || primaryModel,
      content,
      reasoning,
      finishReason,
      usage: payload.usage,
    })
  } catch (error) {
    writeLog({ type: 'server_error', route: '/api/chat', error: error.message })
    return send(res, 500, { ok: false, error: error.message })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DeepSeek local proxy listening on http://localhost:${PORT}`)
  console.log(`Reading API key from ${KEY_PATH}`)
  console.log(`Writing logs to ${LOG_FILE}`)
})
