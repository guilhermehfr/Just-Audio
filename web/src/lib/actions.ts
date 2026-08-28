'use server'

import { isValidYoutubeUrl } from '@just-audio/shared'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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

export interface ExtractAudioResponse {
  error: { code: string; message: string } | null
  data: AudioExtractionResult | null
}

export async function extractAudio(url: string): Promise<ExtractAudioResponse> {
  if (!isValidYoutubeUrl(url)) {
    return { error: { code: 'INVALID_URL', message: 'Invalid YouTube URL' }, data: null }
  }

  try {
    const res = await fetch(`${API_BASE}/api/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })

    const contentType = res.headers.get('content-type') ?? ''
    const text = await res.text()

    let body: ApiResponse<AudioExtractionResult>
    if (!res.ok) {
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(text) as ApiResponse<AudioExtractionResult>
          const err = body.error
          return {
            error: err ? { code: err.code, message: err.message } : { code: `HTTP_${res.status}`, message: `Request failed ${res.status}` },
            data: null,
          }
        } catch {
          // fall through
        }
      }
      const snippet = text.slice(0, 500)
      if (text.includes('<!DOCTYPE') || contentType.includes('text/html')) {
        return {
          error: { code: 'EXTERNAL_SERVICE_ERROR', message: `Bad Gateway (${res.status}) — API returned HTML. Check API health. ${snippet.slice(0, 200)}` },
          data: null,
        }
      }
      return { error: { code: `HTTP_${res.status}`, message: snippet.slice(0, 200) || `Request failed ${res.status}` }, data: null }
    }

    if (!contentType.includes('application/json') && text.trim().startsWith('<!DOCTYPE')) {
      return {
        error: { code: 'EXTERNAL_SERVICE_ERROR', message: `API returned HTML instead of JSON: ${text.slice(0, 200)}` },
        data: null,
      }
    }

    try {
      body = JSON.parse(text) as ApiResponse<AudioExtractionResult>
    } catch {
      return {
        error: { code: 'UNKNOWN', message: `Expected JSON but got ${contentType || 'unknown'}: ${text.slice(0, 200)}` },
        data: null,
      }
    }

    if (!body.success || !body.data) {
      const err = body.error
      return {
        error: err ? { code: err.code, message: err.message } : { code: 'UNKNOWN', message: 'Unknown API error' },
        data: null,
      }
    }

    return { error: null, data: body.data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach server'
    // Surface HTML parse errors as 502, not generic NETWORK_ERROR
    if (msg.includes('<!DOCTYPE') || msg.includes("Unexpected token '<'")) {
      return {
        error: { code: 'EXTERNAL_SERVICE_ERROR', message: `API returned HTML (check API health): ${msg.slice(0, 300)}` },
        data: null,
      }
    }
    return {
      error: { code: 'NETWORK_ERROR', message: msg },
      data: null,
    }
  }
}
