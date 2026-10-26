// Debrief — grava o resumo do Schedule (época IATA) em crm_referencia (chave 'schedule').
// Só quem tem a permissão «reunioes_companhias». O resumo é feito com tools/schedule.py a partir do relatório
// «Schedule Report By Day»; os dados nunca ficam no repositório público.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? 'sb_publishable_wjWRDRsB9LNA7XIn4fsXBw_-_b2yVnV';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_BODY = 2_000_000;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await temAcesso(auth))) return json({ error: 'sem_acesso', message: 'Sem acesso.' }, 403);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'grande', message: 'Ficheiro demasiado grande.' }, 413);
  let d: any; try { d = JSON.parse(raw); } catch { return json({ error: 'pedido_invalido' }, 400); }
  const ok = d && d.v === 1 && /^[SW]\d{2}$/.test(String(d.season)) && /^\d{4}-\d{2}-\d{2}$/.test(String(d.from)) && /^\d{4}-\d{2}-\d{2}$/.test(String(d.to))
    && Array.isArray(d.r) && d.r.length > 0 && d.al && typeof d.al === 'object' && d.ap && typeof d.ap === 'object'
    && d.r.every((r: any) => typeof r?.a === 'string' && typeof r?.c === 'string' && Array.isArray(r?.d) && r.d.length === 7 && Array.isArray(r?.wk) && Number.isFinite(r?.t));
  if (!ok) return json({ error: 'formato', message: 'O ficheiro não tem o formato do schedule.' }, 400);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/crm_referencia?on_conflict=chave`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ chave: 'schedule', versao: d.season, dados: d, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) { console.error('gravar', r.status, (await r.text()).slice(0, 400)); return json({ error: 'gravar', message: 'Não foi possível gravar.' }, 502); }
  return json({ ok: true, season: d.season, rotas: d.r.length });
});
