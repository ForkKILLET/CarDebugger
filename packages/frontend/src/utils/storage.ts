import { reactive, ref, watch, type Reactive, type Ref } from 'vue'

interface Disposable {
  dispose: () => void
}

const tryParseJson = (json: string | undefined | null) => {
  if (! json) return undefined
  try {
    return JSON.parse(json)
  }
  catch {
    return undefined
  }
}

export const storeRef = <T>(key: string, defaultValue: T): Ref<T> & Disposable => {
  const r: Ref<T> = ref(tryParseJson(localStorage.getItem(key)) ?? defaultValue)
  const dispose = watch(r, newValue => localStorage.setItem(key, JSON.stringify(newValue)))
  return Object.assign(r, { dispose })
}

export const storeReactive = <T extends object>(key: string, defaultValue: T): Reactive<T> & Disposable => {
  const value: T = tryParseJson(localStorage.getItem(key)) ?? defaultValue
  const r = reactive(value)
  const dispose = watch(r, newValue => localStorage.setItem(key, JSON.stringify(newValue)))
  return Object.assign(r, { dispose })
}
