export class HttpRequestError extends Error {
  status: number
  body: string

  constructor(message: string, status: number, body = '') {
    super(message)
    this.name = 'HttpRequestError'
    this.status = status
    this.body = body
  }
}

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRIES = 1
const DEFAULT_RETRY_DELAY_MS = 400

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new HttpRequestError(`Request timeout after ${timeoutMs}ms`, 408)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options)
  return response.json() as Promise<T>
}

export async function requestVoid(url: string, options: RequestOptions = {}): Promise<void> {
  await request(url, options)
}

async function request(url: string, options: RequestOptions): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    headers,
    ...init
  } = options

  const method = (init.method ?? 'GET').toUpperCase()
  const maxAttempts = retries + 1
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        timeoutMs,
      )

      if (!response.ok) {
        const body = await response.text()
        const error = new HttpRequestError(`HTTP ${response.status}`, response.status, body)

        if (attempt < maxAttempts && (method === 'GET' || isRetryableStatus(response.status))) {
          await delay(retryDelayMs * attempt)
          continue
        }

        throw error
      }

      return response
    } catch (error) {
      lastError = error
      const isNetworkError = error instanceof TypeError
      const isRetryableHttpError =
        error instanceof HttpRequestError && (error.status === 408 || isRetryableStatus(error.status))

      if (attempt < maxAttempts && (isNetworkError || isRetryableHttpError)) {
        await delay(retryDelayMs * attempt)
        continue
      }

      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed unexpectedly')
}