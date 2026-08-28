import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'stream'

const require = createRequire(import.meta.url)

import { spawn } from 'child_process'
import { env } from '@/config/env'

export interface VideoInfo {
  title: string
  duration: number
  width?: number
  height?: number
  ext?: string
}

export class YouTubeDLError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YouTubeDLError'
  }
}

/**
 * Resolve yt-dlp binary path from youtube-dl-exec package
 */
export function getYtDlpPath(): string {
  const packageJsonPath = require.resolve('youtube-dl-exec/package.json')
  const packageDir = path.dirname(packageJsonPath)

  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const binaryPath = path.join(packageDir, 'bin', binaryName)

  if (!fs.existsSync(binaryPath)) {
    throw new YouTubeDLError(`yt-dlp binary not found at: ${binaryPath}`)
  }

  return binaryPath
}
export async function getVideoMetadata(url: string): Promise<VideoInfo> {
  const ytDlpPath = getYtDlpPath()

  return new Promise((resolve, reject) => {
    let output = ''
    let errorOutput = ''

    const args: string[] = []
    if (fs.existsSync('/app/cookies.txt')) {
      args.push('--cookies', '/app/cookies.txt')
    }
    args.push(
      '--js-runtimes', 'deno',
      '--extractor-args', 'youtube:player_client=android,web',
      '--print', 'title',
      '--print', 'duration',
      '--no-playlist',
      '--no-warnings',
      '-q',
      url,
    )

    const child = spawn(ytDlpPath, args)

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new YouTubeDLError('yt-dlp timed out after 120s'))
    }, 120_000)

    const maxBytes = env.audio.maxFileSize * 1024 * 1024
    let totalBytes = 0
    let settled = false

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      totalBytes += chunk.length
      output += chunk.toString()
      if (totalBytes > maxBytes) {
        settled = true
        clearTimeout(timeout)
        child.kill('SIGTERM')
        child.stdout.destroy()
        reject(new YouTubeDLError(`File too large: exceeded ${env.audio.maxFileSize}MB`))
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })

    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (code !== 0) {
        return reject(
          new YouTubeDLError(`yt-dlp failed with code ${code}: ${errorOutput || 'Unknown error'}`)
        )
      }

      const [title, duration] = output.trim().split('\n')

      resolve({
        title: title || 'Unknown Title',
        duration: parseFloat(duration) || 0,
      })
    })

    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
  })
}
export async function createAudioStream(url: string): Promise<{ stream: Readable }> {
  const ytDlpPath = getYtDlpPath()

  const child = spawn(ytDlpPath, [
    ...(fs.existsSync('/app/cookies.txt') ? ['--cookies', '/app/cookies.txt'] : []),
    '--js-runtimes', 'deno',
    '--extractor-args', 'youtube:player_client=android,web',
    '--format',
    'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-q',
    '-o',
    '-',
    url,
  ])

  if (!child.stdout) {
    throw new YouTubeDLError('Failed to create audio stream - no stdout')
  }

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })

  // Guard: kill if yt-dlp hangs before producing data (no output for 120s)
  const startTimeout = setTimeout(() => {
    child.kill('SIGTERM')
    child.stdout?.destroy(new YouTubeDLError(`yt-dlp audio stream timed out after 120s: ${stderr.slice(0, 500)}`))
  }, 120_000)

  child.stdout.on('data', () => {
    clearTimeout(startTimeout)
  })

  child.on('error', (error: Error) => {
    clearTimeout(startTimeout)
    child.stdout?.destroy(error)
  })

  child.on('close', (code: number | null) => {
    clearTimeout(startTimeout)
    if (code !== null && code !== 0) {
      const err = new YouTubeDLError(`yt-dlp stream failed with code ${code}: ${stderr.slice(0, 500) || 'Unknown error'}`)
      if (!child.stdout.destroyed) child.stdout.destroy(err)
    }
  })

  return { stream: child.stdout }
}
