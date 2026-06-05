import { callDeepSeekDetailed } from './deepseek.js'

const MODEL_PROVIDERS = {
  deepseek: { label: 'DeepSeek', model: 'deepseek-v4-flash', playerModel: 'DeepSeek Flash' },
  'local-rule': { label: '规则兜底', model: 'local-rule', playerModel: 'Local Rule' },
}

const normalizeProvider = (provider) => {
  if (provider === 'ai') return 'deepseek'
  if (provider === 'local') return 'local-rule'
  return MODEL_PROVIDERS[provider] ? provider : 'local-rule'
}

const callModelDetailed = async ({ provider = 'deepseek', ...request }) => {
  const selected = normalizeProvider(provider)
  if (selected === 'deepseek') return callDeepSeekDetailed(request)
  throw new Error('local-rule provider does not call a model')
}

const modelNameForProvider = (provider) => MODEL_PROVIDERS[normalizeProvider(provider)].model
const playerModelForProvider = (provider) => MODEL_PROVIDERS[normalizeProvider(provider)].playerModel

export { MODEL_PROVIDERS, callModelDetailed, modelNameForProvider, normalizeProvider, playerModelForProvider }
