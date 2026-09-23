type InsightFlareEventValue = string | number | boolean | string[]
type InsightFlareEventData = Record<string, InsightFlareEventValue>

type InsightFlareClient = {
  track: (eventName: string, eventData?: InsightFlareEventData) => void
}

declare global {
  interface Window {
    insightflare?: InsightFlareClient
  }
}

export function trackEvent(eventName: string, eventData?: InsightFlareEventData) {
  if (typeof window === 'undefined') return

  try {
    window.insightflare?.track(eventName, eventData)
  } catch {
    // Analytics must never interrupt the printing workflow.
  }
}

export function durationBucket(durationMs: number) {
  if (durationMs < 50) return '<50ms'
  if (durationMs < 200) return '50-199ms'
  if (durationMs < 500) return '200-499ms'
  if (durationMs < 2_000) return '500-1999ms'
  return '2000ms+'
}

export function countBucket(count: number) {
  if (count <= 0) return '0'
  if (count < 100) return '1-99'
  if (count < 500) return '100-499'
  if (count < 2_000) return '500-1999'
  return '2000+'
}
