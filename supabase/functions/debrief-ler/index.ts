// Debrief — leitura de fotos com o Claude (notas manuscritas e cartões de visita), tradução, sumário e organização das notas.
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
const ORG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] } },
    next_steps: { type: 'array', items: { type: 'string' } },
    keep: { type: 'array', items: { type: 'string' } },
  },
  required: ['topics', 'next_steps', 'keep'],
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

  // Tradução das notas (Comments do Salesforce) para inglês
  if (body?.mode === 'translate') {
    const text = String(body?.text ?? '').slice(0, 20000);
    if (!text.trim()) return json({ error: 'pedido_invalido' }, 400);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content: [
        'Translate into English the following notes of a business meeting between Porto Airport (ANA Aeroportos de Portugal / VINCI Airports) and an airline. They will be saved in Salesforce.',
        'Rules:',
        '- Keep exactly the same structure: same line breaks, same order, headings stay in UPPERCASE on their own line.',
        '- Translate the headings too (e.g. NOTAS → NOTES, PRÓXIMOS PASSOS → NEXT STEPS, "Participantes ANA" → "ANA participants", "Participantes <airline>" → "<airline> participants").',
        '- Keep names of people, companies, airport and airline codes, aircraft types, numbers, dates and amounts unchanged.',
        '- Use clear, professional British English with aviation terminology (slots, frequencies, OTP, PRM, handling, load factor, incentives, charges).',
        '- Do not add, remove or summarise anything. Output only the translation.',
        '', '---', text,
      ].join('\n') }] }),
    });
    if (!r.ok) { const t = await r.text(); console.error('anthropic', r.status, t.slice(0, 500)); return json({ error: 'claude', message: r.status === 429 ? 'Limite de utilização atingido.' : 'O Claude não respondeu.' }, 502); }
    const out = await r.json();
    const en = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    return json({ mode: 'translate', text: en, model: out.model, usage: out.usage });
  }

  // Sumário executivo das notas (para os Comments do Salesforce)
  if (body?.mode === 'summary') {
    const text = String(body?.text ?? '').slice(0, 20000);
    if (!text.trim()) return json({ error: 'pedido_invalido' }, 400);
    const en = body?.lang === 'en';
    const airline = clean(body?.airline, 80);
    const prompt = (en ? [
      `Write an executive summary of these notes from a meeting between Porto Airport (ANA Aeroportos de Portugal / VINCI Airports) and ${airline || 'an airline'}. It goes into Salesforce for colleagues and management who did not attend.`,
      'Rules:',
      '- One paragraph of 3 to 5 sentences, at most about 90 words. No headings, no bullet points.',
      '- Lead with the most important point for the airport (opportunity, risk or decision). Then the main topics discussed and the agreed next steps with owners and dates, if they are in the notes.',
      '- Keep names, airport and airline codes, aircraft types, numbers, dates and amounts exactly as written. Clear, professional British English.',
      '- Do not invent anything and do not add opinions. Output only the summary.',
    ] : [
      `Escreve um sumário executivo destas notas de uma reunião do Aeroporto do Porto (ANA Aeroportos de Portugal / VINCI Airports) com ${airline ? `a ${airline}` : 'uma companhia aérea'}. Vai para o Salesforce, para colegas e chefias que não estiveram na reunião.`,
      'Regras:',
      '- Um parágrafo de 3 a 5 frases, no máximo cerca de 90 palavras. Sem títulos nem listas.',
      '- Começa pelo ponto mais importante para o aeroporto (oportunidade, risco ou decisão). Depois os principais temas e os próximos passos acordados, com responsáveis e prazos se estiverem nas notas.',
      '- Mantém nomes, códigos de aeroportos e companhias, aeronaves, números, datas e valores exatamente. Português de Portugal, claro e profissional.',
      '- Não inventes nada nem acrescentes opiniões. Responde só com o sumário.',
    ]).concat(['', '---', text]).join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) { const t = await r.text(); console.error('anthropic', r.status, t.slice(0, 500)); return json({ error: 'claude', message: r.status === 429 ? 'Limite de utilização atingido.' : 'O Claude não respondeu.' }, 502); }
    const out = await r.json();
    const sum = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    return json({ mode: 'summary', text: sum, model: out.model, usage: out.usage });
  }

  // Organizar as notas da reunião por temas, com próximos passos
  if (body?.mode === 'organize') {
    const raw = String(body?.text ?? '').slice(0, 20000);
    if (!raw.trim()) return json({ error: 'pedido_invalido' }, 400);
    const airline = clean(body?.airline, 80);
    const topics = Array.isArray(body?.topics) ? body.topics.slice(0, 40).map((t: unknown) => clean(t, 60)).filter(Boolean) : [];
    const prompt = [
      `Organiza as notas soltas de uma reunião do Aeroporto do Porto (ANA / VINCI Airports) com ${airline ? `a companhia ${airline}` : 'uma companhia aérea'}. As notas foram escritas à pressa, durante ou logo depois da reunião, e vão para o Salesforce.`,
      topics.length ? `Temas habituais (usa estes nomes, exatamente assim, sempre que servirem): ${topics.join(' | ')}.` : '',
      '',
      'Regras:',
      '- Agrupa por tema. Cria um tema novo só se nenhum dos habituais servir, com um nome curto no mesmo estilo.',
      '- Em cada tema, escreve o que foi dito em frases curtas e claras, por ordem lógica. Junta ideias repetidas. Corrige abreviaturas óbvias e gralhas, mas mantém siglas, códigos de aeroportos e companhias, números, datas e valores exatamente.',
      '- Não inventes nada nem acrescentes interpretações. Mantém a língua das notas (português e/ou inglês, como estiverem).',
      '- Próximos passos: só compromissos e ações concretas (quem faz o quê e quando, se estiver nas notas), uma por linha, começando pelo verbo. Estas ações não se repetem nos temas.',
      '- «keep»: o que não percebes ou não encaixa em nenhum tema (fica nas notas por organizar). Normalmente vazio.',
      '- Ordena os temas do mais importante para o menos importante para esta reunião.',
      '', 'Notas:', raw,
    ].filter((x) => x !== '').join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, output_config: { format: { type: 'json_schema', schema: ORG_SCHEMA } }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) { const t = await r.text(); console.error('anthropic', r.status, t.slice(0, 500)); return json({ error: 'claude', message: r.status === 429 ? 'Limite de utilização atingido.' : 'O Claude não respondeu.' }, 502); }
    const out = await r.json();
    const f = parseJson(out);
    const topicsOut = (Array.isArray(f.topics) ? f.topics : []).map((t: any) => ({ name: clean(t?.name, 60), text: String(t?.text ?? '').trim().slice(0, 4000) })).filter((t: any) => t.name && t.text);
    const list = (x: unknown) => (Array.isArray(x) ? x : []).map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 40);
    return json({ mode: 'organize', topics: topicsOut, next_steps: list(f.next_steps), keep: list(f.keep), model: out.model, usage: out.usage });
  }

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
