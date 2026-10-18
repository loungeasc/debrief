// Debrief — leitura de fotos com o Claude (notas manuscritas e cartões de visita).
// A chave da API fica só nos segredos do Supabase (ANTHROPIC_API_KEY); nunca vai para a app.
// Só aceita pedidos de quem tem sessão iniciada e a permissão «reunioes_companhias».
// As imagens não são guardadas aqui: seguem para o Claude e a resposta volta para a app.

const MODEL = Deno.env.get('DEBRIEF_MODEL') ?? 'claude-sonnet-5-5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? 'sb_publishable_wjWRDRsB9LNA7XIn4fsXBw_-_b2yVnV';
const MAX_B64 = 8_000_000; // ~6 MB de imagem

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function temAcesso(auth: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_tem_acesso`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

const clean = (s: unknown, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function notesPrompt(airline: string, topics: string[]) {
  return [
    'Transcreve as notas manuscritas desta fotografia.',
    `Contexto: notas de uma reunião do Aeroporto do Porto (ANA / VINCI Airports) com ${airline ? `a companhia ${airline}` : 'uma companhia aérea'}.`,
    topics.length ? `Temas habituais destas reuniões: ${topics.join(', ')}.` : '',
    'Vocabulário frequente: OTP, PMR, slots, handling, lounge, IATA, S26, W26, LIS, OPO, FNC, PDL, rotas, frequências, taxas, incentivos, load factor.',
    '',
    'Regras:',
    '- Copia fielmente o que está escrito, na língua original (português e/ou inglês). Não traduzas nem resumas.',
    '- Uma ideia por linha, pela ordem do papel. Se uma ideia continua na linha seguinte do papel, junta-a numa só linha.',
    '- Mantém abreviaturas, siglas, números, datas e valores tal como estão escritos.',
    '- Tira marcadores (traços, pontos, setas) do início das linhas.',
    '- Ignora riscados, desenhos e rabiscos.',
    '- Se uma palavra não for legível, escreve [?] no lugar dela.',
    '- Não acrescentes títulos, comentários nem explicações. Responde só com o texto transcrito.',
    '- Se não houver texto legível, responde com uma linha vazia.',
  ].join('\n');
}

const CARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      firstName: { type: 'string', description: 'Nome próprio' },
      lastName: { type: 'string', description: 'Apelido(s)' },
      title: { type: 'string', description: 'Cargo, tal como escrito' },
      company: { type: 'string', description: 'Empresa ou companhia aérea' },
      email: { type: 'string' },
      phone: { type: 'string', description: 'Telefone fixo / escritório, com indicativo se existir' },
      mobile: { type: 'string', description: 'Telemóvel, com indicativo se existir' },
      website: { type: 'string' },
      text: { type: 'string', description: 'Todo o texto do cartão, linha a linha' },
    },
    required: ['firstName', 'lastName', 'title', 'company', 'email', 'phone', 'mobile', 'website', 'text'],
};
function parseJson(out: any) {
  const t = (out?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'sem_chave', message: 'Falta a chave da API do Claude nos segredos do Supabase.' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await temAcesso(auth))) return json({ error: 'sem_acesso', message: 'Sem acesso às reuniões.' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'pedido_invalido' }, 400); }
  const mode = body?.mode === 'card' ? 'card' : 'notes';
  const image = String(body?.image ?? '');
  if (!image || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json({ error: 'imagem_invalida' }, 400);
  const airline = clean(body?.airline, 80);
  const topics = Array.isArray(body?.topics) ? body.topics.slice(0, 30).map((t: unknown) => clean(t, 60)).filter(Boolean) : [];

  const img = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } };
  const payload: Record<string, unknown> = mode === 'card'
    ? {
        model: MODEL, max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: CARD_SCHEMA } },
        messages: [{ role: 'user', content: [img, { type: 'text', text: 'Lê este cartão de visita e preenche os campos. Usa texto vazio nos campos que não existam no cartão. Não inventes dados. Nomes em maiúsculas passam para a forma normal (ex.: JOÃO SILVA → João Silva).' }] }],
      }
    : {
        model: MODEL, max_tokens: 2500,
        messages: [{ role: 'user', content: [img, { type: 'text', text: notesPrompt(airline, topics) }] }],
      };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('anthropic', r.status, t.slice(0, 500));
    return json({ error: 'claude', status: r.status, message: r.status === 401 ? 'Chave da API inválida.' : r.status === 429 ? 'Limite de utilização atingido.' : 'O Claude não respondeu.' }, 502);
  }
  const out = await r.json();
  const usage = out.usage ?? {};
  if (mode === 'card') {
    const f = parseJson(out);
    const fields: Record<string, string> = {};
    for (const k of ['firstName', 'lastName', 'title', 'company', 'email', 'phone', 'mobile', 'website']) fields[k] = clean(f[k], 160);
    return json({ mode, fields, text: String(f.text ?? '').slice(0, 3000), model: out.model, usage });
  }
  const text = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
  return json({ mode, text, model: out.model, usage });
});
