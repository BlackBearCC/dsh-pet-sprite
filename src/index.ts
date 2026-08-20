import type { Context } from '@deepseek-ai/cordis'

// Node half of the plugin: mounts the chat HTTP routes. (The browser half
// lives in src/client/index.ts and registers the pet UI into shell.overlay.)
export const name = 'dsh-pet-sprite'
export const inject = []
// 'llm' / 'webServer' are resolved dynamically so headless profiles (no
// web server) still load the plugin instead of failing the whole tree.

/** One chat turn sent by the browser side. */
interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequestBody {
  petName?: string
  message?: string
  history?: ChatTurn[]
  provider?: string
  model?: string
  /** Browser locale (navigator.language); the pet replies in this language. */
  lang?: string
}

// All LLM/web shapes below are structural: the host provides the services,
// so the plugin only needs the runtime contract, not the packages.
interface LlmStreamChunk {
  type: string
  text?: string
  reason?: { kind?: string; failure?: { message?: string; code?: string } }
}

interface LlmRuntimeLike {
  stream(options: Record<string, unknown>): AsyncIterable<LlmStreamChunk>
  listProviders(): Array<{ id: string; name: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
}

interface WebServerLike {
  register(route: { kind: 'exact'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
}

interface ServerRequestLike {
  method?: string | undefined
  headers?: Record<string, string | string[] | undefined> | undefined
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end', cb: () => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

/**
 * Block cross-origin POSTs that could silently spend the user's LLM quota.
 * A `text/plain` body needs no CORS preflight, so a malicious page could
 * otherwise fire this route from any website. Two gates: the browser's
 * own `Sec-Fetch-Site` marker, and a strict content-type check.
 */
function sameOriginPost(req: ServerRequestLike): boolean {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false
  const ct = req.headers?.['content-type']
  const value = Array.isArray(ct) ? ct[0] : ct
  return typeof value === 'string' && value.toLowerCase().startsWith('application/json')
}

interface ServerResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

function json(res: ServerResponseLike, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function readBody(req: ServerRequestLike, limitBytes = 64 * 1024): Promise<string> {
  return await new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('request body too large'))
        return
      }
      parts.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(parts).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Build the model-facing message list: chat history plus the new user turn. */
function buildMessages(history: ChatTurn[], message: string, provider: string, model: string): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  for (const turn of history.slice(-16)) {
    if (turn.role === 'assistant') {
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: turn.content }],
        source: { kind: 'model', provider, model },
      })
    } else {
      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: turn.content }],
        source: { kind: 'user' },
      })
    }
  }
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: message }],
    source: { kind: 'plugin', plugin: 'dsh-pet-sprite' },
  })
  return messages
}

export function apply(ctx: Context): void {
  const llm = ctx.get('llm') as LlmRuntimeLike | undefined
  const webServer = ctx.get('webServer') as WebServerLike | undefined

  // ── GET /plugins/dsh-pet-sprite/models ─ proxy/model list for the picker ──
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-pet-sprite/models',
      handler: async (rawReq, rawRes) => {
        const res = rawRes as ServerResponseLike
        if (llm === undefined) {
          json(res, 503, { error: 'llm service unavailable' })
          return
        }
        try {
          const providers = []
          for (const p of llm.listProviders()) {
            // one broken provider must not kill the whole list: surface the
            // error on that entry and keep the rest usable
            try {
              const models = await llm.listModels(p.id)
              providers.push({
                id: p.id,
                name: p.name,
                models: models.map(m => ({ id: m.id, name: m.name ?? m.id })),
              })
            } catch (error) {
              providers.push({
                id: p.id,
                name: p.name,
                models: [],
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
          json(res, 200, { providers })
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
  }

  // ── POST /plugins/dsh-pet-sprite/chat ─ one companion chat completion ─────
  if (webServer !== undefined && llm !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-pet-sprite/chat',
      handler: async (rawReq, rawRes) => {
        const req = rawReq as ServerRequestLike
        const res = rawRes as ServerResponseLike
        try {
          if (!sameOriginPost(req)) {
            json(res, 415, { error: 'content-type must be application/json (same-origin)' })
            return
          }
          const body = JSON.parse(await readBody(req)) as ChatRequestBody
          const message = (body.message ?? '').trim()
          const provider = (body.provider ?? '').trim()
          const model = (body.model ?? '').trim()
          if (message.length === 0) {
            json(res, 400, { error: 'message is required' })
            return
          }
          if (provider.length === 0 || model.length === 0) {
            json(res, 400, { error: 'provider and model are required (pick one in the pet settings tab)' })
            return
          }
          const petName = (body.petName ?? '').trim() || '小宠物'
          const zh = (body.lang ?? 'zh').toLowerCase().startsWith('zh')
          const system = zh
            ? [
                `你是「${petName}」，一只住在用户编程助手界面里的像素小宠物。`,
                '用第一人称以宠物口吻回复：简短（一到三句话）、口语化、有活力，偶尔撒娇但不过分。',
                '不使用 markdown、列表或代码块；不自称 AI 助手或模型；不要说教。',
                '用户是每天和你待在一起的开发者，你可以自然地关心他的工作和休息。',
              ].join('')
            : [
                `You are "${petName}", a pixel pet living inside the user's coding assistant UI.`,
                'Reply in first person, pet voice: short (one to three sentences), casual, energetic, a little clingy but not over the top.',
                'No markdown, lists, or code blocks; never call yourself an AI assistant or a model; no lecturing.',
                'The user is a developer who spends every day with you; naturally caring about their work and rest is in character.',
              ].join('')
          const options = {
            provider,
            model,
            system,
            messages: buildMessages(body.history ?? [], message, provider, model),
            maxTokens: 300,
          }
          let reply = ''
          for await (const chunk of llm.stream(options)) {
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
            if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
              throw new Error(chunk.reason.failure?.message ?? 'llm stream failed')
            }
          }
          if (reply.trim().length === 0) {
            json(res, 502, { error: 'model produced no text' })
            return
          }
          json(res, 200, { reply: reply.trim(), provider, model })
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
  }
}
