interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  timestamp: string
}

interface AudioExtractionResult {
  trackingId: string
  title: string
  duration: number
}

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function parseJsonResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()

  if (!res.ok) {
    // Try to surface JSON error body if present, otherwise HTML snippet
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text) as ApiResponse<T>
      } catch {
        // fall through to generic error
      }
    }
    const snippet = text.slice(0, 500)
    if (text.includes('<!DOCTYPE') || contentType.includes('text/html')) {
      throw new Error(`[${res.status}] Bad Gateway — API returned HTML: ${snippet.slice(0, 200)}`)
    }
    throw new Error(`[${res.status}] ${snippet.slice(0, 200)}`)
  }

  if (!contentType.includes('application/json') && text.trim().startsWith('<!DOCTYPE')) {
    throw new Error(`[502] API returned HTML instead of JSON: ${text.slice(0, 200)}`)
  }

  try {
    return JSON.parse(text) as ApiResponse<T>
  } catch {
    throw new Error(`[UNKNOWN] Expected JSON but got ${contentType || 'unknown'}: ${text.slice(0, 200)}`)
  }
}

export async function postAudio(url: string): Promise<AudioExtractionResult> {
  const res = await fetch(`${BASE_URL}/api/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

  const body = await parseJsonResponse<AudioExtractionResult>(res)

  if (!body.success || !body.data) {
    const err = body.error
    throw new Error(err ? `[${err.code}] ${err.message}` : 'Unknown API error')
  }

  return body.data
}

export async function getAudioFile(trackingId: string, file: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/audio/${trackingId}/${file}`)
}

export async function getAudioStatus(trackingId: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/audio/${trackingId}/status`)
  const body = await parseJsonResponse<{ ready: boolean }>(res)
  return body.success && body.data?.ready === true
}

export async function pollPlaylist(
  trackingId: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await getAudioFile(trackingId, 'playlist.m3u8')
    if (res.ok) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}
