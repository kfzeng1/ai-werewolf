import { Capacitor } from '@capacitor/core'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = 'http://localhost:8787'
const KEY_STORAGE_KEY = 'ai-werewolf.deepseek-api-key'
const APP_SURFACE_LABEL = IS_NATIVE ? 'Mobile' : 'Web'
const DEFAULT_MOBILE_API_KEY = import.meta.env?.VITE_DEEPSEEK_API_KEY ?? ''

const readStoredApiKey = () => {
  if (typeof window === 'undefined') return ''
  const storedKey = window.localStorage.getItem(KEY_STORAGE_KEY) ?? ''
  if (storedKey.trim()) return storedKey
  return IS_NATIVE ? DEFAULT_MOBILE_API_KEY : ''
}

export { API_BASE, APP_SURFACE_LABEL, IS_NATIVE, KEY_STORAGE_KEY, readStoredApiKey }
