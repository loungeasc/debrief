// Debrief — «Perguntar»: conversa com o Claude sobre as reuniões, contactos, notícias e o simulador.
// O Claude pede os dados através de ferramentas que correm NO DISPOSITIVO (a app responde e volta a chamar esta função).
// Esta função só junta o pedido, guarda a chave (segredo ANTHROPIC_API_KEY) e devolve a resposta em streaming.

const MODEL = Deno.env.get('DEBRIEF_CHAT_MODEL') ?? Deno.env.get('DEBRIEF_MODEL') ?? 'claude-sonnet-5-5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? 'sb_publishable_wjWRDRsB9LNA7XIn4fsXBw_-_b2yVnV';
const MAX_BODY = 1_500_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function temAcesso(auth: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_tem_acesso`, { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
  return r.ok && (await r.json()) === true;
}
const clean = (s: unknown, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

const TOOLS = [
  {
    name: 'procurar_reunioes',
    description: 'Procura reuniões no Debrief (as do utilizador e as do colega). Devolve uma lista curta com id, data, companhia, assunto, estado, temas e o início das notas. Usa ler_reuniao para o texto completo.',
    input_schema: { type: 'object', properties: {
      companhia: { type: 'string', description: 'Nome ou código IATA da companhia (ex.: Ryanair, FR). Opcional.' },
      texto: { type: 'string', description: 'Palavras a procurar nas notas, temas, próximos passos e participantes. Opcional.' },
      desde: { type: 'string', description: 'Data mínima AAAA-MM-DD. Opcional.' },
      ate: { type: 'string', description: 'Data máxima AAAA-MM-DD. Opcional.' },
      limite: { type: 'integer', description: 'Máximo de resultados (predefinido 15, máximo 40).' },
    } },
  },
  {
    name: 'ler_reuniao',
    description: 'Lê uma reunião completa: companhia, data, local, participantes, temas com o texto, notas por organizar, próximos passos, simulações guardadas e estado.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'procurar_contactos',
    description: 'Procura contactos guardados (nome, cargo, companhia, email, telefones).',
    input_schema: { type: 'object', properties: { texto: { type: 'string' }, companhia: { type: 'string' } } },
  },
  {
    name: 'ler_preparacao',
    description: 'Lê a preparação guardada de uma companhia: resumo, notícias escolhidas com «porque importa», pontos para a reunião e resumo das reuniões anteriores.',
    input_schema: { type: 'object', properties: { companhia: { type: 'string' } }, required: ['companhia'] },
  },
  {
    name: 'procurar_noticias',
    description: 'Procura no arquivo de notícias de aviação (CAPA, Aeroroutes, AeroTime, Simple Flying, imprensa portuguesa e espanhola…), dos últimos meses.',
    input_schema: { type: 'object', properties: {
      texto: { type: 'string', description: 'Palavras a procurar no título e resumo (ex.: "Ryanair Porto").' },
      dias: { type: 'integer', description: 'Só notícias dos últimos N dias (predefinido 120).' },
    }, required: ['texto'] },
  },
  {
    name: 'listar_aeronaves',
    description: 'Lista tipos de aeronave (código ICAO, descrição, PMD/MTOW, lugares, categoria de ruído). Filtra por texto e/ou pelas usadas por uma companhia.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' }, companhia: { type: 'string' } } },
  },
  {
    name: 'simular_rota',
    description: 'Simula uma rota com o Simulador de Taxas 2026 e o programa de incentivos Non-Based 2024–2028: incentivo (ano 1, ano 2, por passageiro, por época IATA e elegibilidade), taxas por rotação e no período, taxas ANA líquidas e comparação com Lisboa e Faro. Usa SEMPRE esta ferramenta para valores de taxas ou incentivos.',
    input_schema: { type: 'object', properties: {
      voos_semana: { type: 'number' },
      aeroporto: { type: 'string', description: 'Código (OPO, LIS, FAO, FNC, PXO, PDL, …). Predefinido: o do utilizador.' },
      companhia: { type: 'string', description: 'Para sugerir a aeronave da frota.' },
      aeronave: { type: 'string', description: 'Código ICAO (ex.: A320, A21N, B738). Opcional.' },
      lugares: { type: 'integer' },
      load_factor: { type: 'number', description: '% (predefinido 85).' },
      inicio: { type: 'string', description: 'AAAA-MM-DD (predefinido: início da próxima época IATA).' },
      partida: { type: 'string', description: 'Hora de partida HH:MM (conta para o off-peak).' },
      tipo_incentivo: { type: 'string', enum: ['nova', 'monopolio'] },
      destino: { type: 'string', enum: ['S', 'UE', 'INT'], description: 'Schengen, UE fora de Schengen ou internacional.' },
    }, required: ['voos_semana'] },
  },
];

function systemPrompt(ctx: any) {
  const ap = clean(ctx?.aeroporto || 'OPO', 3);
  const nome = clean(ctx?.utilizador || 'o utilizador', 60);
  const r = ctx?.reuniao;
  return [
    `És o assistente do Debrief, a app que ${nome} usa para as reuniões com companhias aéreas na área comercial de aviação do Aeroporto do Porto (${ap}; ANA Aeroportos de Portugal / VINCI Airports). As notas vão depois para o Salesforce.`,
    `Hoje é ${clean(ctx?.hoje, 40) || new Date().toISOString().slice(0, 10)}.${ctx?.concorrentes ? ` Aeroportos concorrentes: ${clean(ctx.concorrentes, 80)}.` : ''}`,
    '',
    'Como trabalhas:',
    '- Respondes em português de Portugal, direto, frases curtas. Usa listas quando ajudam. Sem floreados.',
    '- Tens ferramentas que leem os dados do Debrief (reuniões partilhadas com o colega, contactos, preparações, arquivo de notícias) e o simulador de taxas e incentivos. Usa-as em vez de adivinhar.',
    '- Para qualquer valor de taxas ou incentivos usa sempre simular_rota e diz os pressupostos (aeronave, lugares, load factor, início).',
    '- Quando citas o que foi dito numa reunião, indica a data e a companhia. Se não encontrares nada, diz isso.',
    '- Não inventes números, datas nem compromissos. Distingue factos (das notas ou notícias) de leituras tuas.',
    '- As notas e as simulações são internas da ANA. Em textos para enviar a companhias (emails, resumos), não incluas notas internas nem a modulação interna por ruído.',
    '- Não tens acesso para alterar dados nem enviar mensagens: preparas o texto e o utilizador decide.',
    r ? `\nO utilizador está a ver a reunião id=${clean(r.id, 60)} com ${clean(r.companhia, 80)} em ${clean(r.data, 20)}. «Esta reunião» refere-se a ela; lê-a com ler_reuniao quando precisares.` : '',
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'sem_chave', message: 'Falta a chave da API do Claude nos segredos do Supabase.' }, 503);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await temAcesso(auth))) return json({ error: 'sem_acesso', message: 'Sem acesso às reuniões.' }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'grande', message: 'A conversa ficou demasiado longa. Começa uma nova.' }, 413);
  let body: any; try { body = JSON.parse(raw); } catch { return json({ error: 'pedido_invalido' }, 400); }
  // Blocos de raciocínio: têm de voltar intactos; um bloco sem assinatura não serve e é retirado.
  const messages = (Array.isArray(body?.messages) ? body.messages : []).map((m: any) => {
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) return m;
    const content = m.content.filter((b: any) => !(b?.type === 'thinking' && !b.signature)).map((b: any) => (b?.type === 'thinking' && typeof b.thinking !== 'string' ? { ...b, thinking: '' } : b));
    return { ...m, content: content.length ? content : [{ type: 'text', text: '…' }] };
  });
  if (!messages.length || messages.length > 120) return json({ error: 'pedido_invalido', message: 'Conversa inválida.' }, 400);

  const tools: unknown[] = [...TOOLS];
  if (body?.web) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'Porto', country: 'PT', timezone: 'Europe/Lisbon' } });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, stream: true, system: systemPrompt(body?.contexto), tools, messages }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text(); console.error('anthropic', r.status, t.slice(0, 600));
    try { const a = messages.find((m: any) => m.role === 'assistant'); if (a) console.error('forma', 'app', String(body?.app || '?'), JSON.stringify(a.content.map((b: any) => ({ t: b.type, k: Object.keys(b), th: typeof b.thinking === 'string' ? b.thinking.length : null, sg: typeof b.signature === 'string' ? b.signature.length : null })))); } catch { /* */ }
    let msg = r.status === 401 ? 'Chave da API inválida.' : r.status === 429 ? 'Limite de utilização atingido. Tenta daqui a pouco.' : 'O Claude não respondeu.';
    if (/web search/i.test(t)) msg = 'A pesquisa na web não está ativa na conta da API. Desliga a opção Web.';
    return json({ error: 'claude', status: r.status, message: msg }, 502);
  }
  return new Response(r.body, { headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
});
