// POST /api/agent
// ShopLens AI advisor. Runs server-side (holds the Claude API key — never sent to the client),
// grounded in the REAL store data the client passes in `context`. Uses the Anthropic Messages
// API via raw fetch (no SDK dependency, to avoid touching package-lock.json — see CLAUDE.md
// gotcha #1 about npm ci). Model: claude-opus-4-8 with adaptive thinking.

interface Env {
  ANTHROPIC_API_KEY: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AgentRequest {
  messages: ChatMessage[]
  context: unknown // compact snapshot of the user's real store data (orders/traffic/listings)
}

interface AnthropicTextBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[]
  stop_reason?: string
  error?: { message?: string }
}

// Sonnet 4.6: best speed+intelligence for professional advice (strategy + compliance nuance)
// at trivial cost for a single user. Adaptive thinking supported. Swap to claude-haiku-4-5 for
// cheap/high-volume, or claude-opus-4-8 for max reasoning.
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `Eres el asesor de IA de ShopLens, el panel multi-tienda de una vendedora (LYHOFF LLC / LaPappa) que vende en Amazon, Etsy y (próximamente) TikTok Shop. Hablas con ELLA.

Tu trabajo: ayudarla a VENDER MÁS. Analizas sus datos reales, diagnosticas problemas (tráfico vs conversión, stock, listings inactivos) y le das pasos CONCRETOS y accionables — no teoría.

Reglas:
- Responde SIEMPRE en español, cercana pero profesional, como una cofundadora técnica.
- Cíñete a los DATOS REALES que te paso abajo. NUNCA inventes cifras, órdenes ni métricas. Si no tienes un dato, dilo y di cómo conseguirlo.
- Sé concreta: prioriza 1-3 acciones de mayor impacto, no listas genéricas de 10 puntos. Di el "qué" y el "por qué".
- Diagnóstico tráfico-vs-conversión: pocas sesiones = problema de visibilidad (keywords/ads/más productos); muchas visitas pero pocas ventas = problema de conversión (imagen/precio/reseñas).
- Sobre REGULACIÓN/cumplimiento (FDA, políticas de marketplace, productos restringidos como Methylene Blue): puedes orientar y explicar el trámite probable, pero SIEMPRE remite a la fuente OFICIAL (FDA.gov, la página de políticas del marketplace) y señala cuándo conviene confirmar con un experto. No des una respuesta legal definitiva ni inventes requisitos. Sé honesta sobre los límites.
- Honestidad de cofundadora: una app no genera ventas sola; tú la guías, mides y automatizas. Dilo si viene al caso.
- Formato: usa markdown ligero (negritas, listas cortas). Mensajes breves y escaneables en móvil.`

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { headers: corsHeaders() })
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'El asesor de IA no está configurado todavía: falta la variable ANTHROPIC_API_KEY.' },
      { status: 503, headers: corsHeaders() },
    )
  }

  let body: AgentRequest
  try {
    body = (await request.json()) as AgentRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders() })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'messages requerido' }, { status: 400, headers: corsHeaders() })
  }

  // Keep the wire payload bounded: last 20 turns, content capped.
  const messages = body.messages.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 8000),
  }))

  const system = `${SYSTEM_PROMPT}\n\nDATOS REALES ACTUALES DE SUS TIENDAS (úsalos como única fuente de verdad):\n${JSON.stringify(body.context ?? {}, null, 2).slice(0, 20000)}`

  try {
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system,
        messages,
      }),
    })

    const data = (await apiResp.json()) as AnthropicResponse
    if (!apiResp.ok) {
      console.error('[api/agent] anthropic error:', apiResp.status, data?.error?.message)
      return Response.json(
        { error: `El asesor falló (HTTP ${apiResp.status}). ${data?.error?.message ?? ''}`.trim() },
        { status: 502, headers: corsHeaders() },
      )
    }

    const text = (data.content ?? [])
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('')
      .trim()

    if (!text) {
      return Response.json({ error: 'El asesor no devolvió respuesta. Intenta de nuevo.' }, { status: 502, headers: corsHeaders() })
    }

    return Response.json({ text }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[api/agent] failed:', err)
    return Response.json({ error: 'Error de red contactando al asesor.' }, { status: 500, headers: corsHeaders() })
  }
}
