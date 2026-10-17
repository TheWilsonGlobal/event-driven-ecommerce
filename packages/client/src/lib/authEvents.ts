// Tiny pub/sub so non-React code (apiFetch) can ask the UI to prompt for sign-in.
type Listener = (reason: string) => void
const listeners = new Set<Listener>()

export function onAuthRequired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitAuthRequired(reason: string): void {
  listeners.forEach((l) => l(reason))
}
