# Debrief — notas de reuniões com companhias

App para registar reuniões com companhias aéreas logo a seguir à reunião (telemóvel) e passar para o Salesforce como **New Meeting Note** (portátil ou telemóvel).

Com sessão do Portal, os dados ficam no Supabase do Portal (partilhados com o colega) e numa cópia no dispositivo para trabalhar sem rede. Sem sessão, ficam só no dispositivo.

## Publicar (GitHub Pages)

1. Cria um repositório novo (ex.: `debrief`) e carrega **todos os ficheiros e pastas** desta pasta, mantendo a estrutura (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `vendor/`).
2. Em *Settings → Pages*, escolhe o ramo `main` e a pasta `/ (root)`.
3. Abre o endereço `https://<conta>.github.io/debrief/`.

Funciona em qualquer alojamento com **https** (o modo offline e a cópia para a área de transferência exigem https). Não precisa de base de dados nem de servidor.

## Instalar no telemóvel

- **iPhone (Safari):** Partilhar → *Adicionar ao ecrã principal*. Importante: instalada assim, o iOS não apaga os dados por falta de uso.
- **Android (Chrome):** menu ⋮ → *Instalar app*.

Abre uma vez com rede para descarregar o leitor de cartões (~12 MB). Depois funciona sem rede.

## Fluxo

1. **+** → companhia → **Cartão de visita** (fotografa; os dados são lidos automaticamente) → escreve tudo em **Notas da reunião**, uma ideia por linha, sem ordem → **Organizar com IA** (o Claude arruma por temas e tira os próximos passos; revês e carregas em «Aplicar»; sem rede, organizas à mão) → **Marcar como concluída**.
   O ecrã da reunião muda conforme o momento: antes da hora mostra a preparação; durante e nas horas seguintes, só contacto, notas, fotos e próximos passos; depois (e no portátil), temas e campos do Salesforce. O resto fica em **Mais**. No topo da lista, o cartão **Agora** mostra a reunião a decorrer, a que acabou sem notas ou a próxima de hoje.
   - Fotos de notas em papel: abre a foto → **Texto** para extrair o texto (com IA quando há rede; ver abaixo), rever e juntar às notas. No iPhone/iPad também podes tocar e manter sobre o texto da foto (Texto ao Vivo).
   - O que ficar por organizar vai para os Comments como «Notas».
2. No Salesforce: conta da companhia → **New Meeting Note**. No Debrief, toca em **Salesforce** e copia cada campo pela ordem do formulário (Subject, Name, Related To, Due Date, Flag, Type of Tradeshow, Geographical Scope, Comments).
   Os **Comments** podem ir completos, só com um **sumário executivo** (um parágrafo curto escrito pelo Claude, guardado na reunião) ou com o sumário no topo e as notas completas a seguir — escolhe em «Completo · Sumário · Sumário + completo». Também podem ir em português ou em inglês: no botão **PT | EN** (no Salesforce e na pré-visualização do portátil) escolhe EN e o Claude traduz as notas. A tradução fica guardada na reunião (o colega também a vê); se mudares as notas depois, aparece o aviso «Traduzir de novo». A escolha também vale para o CSV do Data Loader (só se a tradução estiver em dia).
3. **Já gravei — marcar exportada.**

Subject automático: `Meeting_OPO_<código IATA>_<evento ou temas>` (prefixo e aeroporto em Definições).

## Agenda do evento (Grip, Google, Outlook…)

Definições → **Agenda do evento** → cola o endereço do calendário (`webcal://…`) → **Guardar e sincronizar**.
As reuniões entram como «Confirmadas» só quando alguém de fora da ANA (a companhia) já aceitou; até lá ficam «Por confirmar» (e se todos os de fora recusarem, ficam canceladas). Enquanto um de nós (tu ou o colega do Debrief) ainda não aceitou no calendário, ficam «Por aceitar», a azul claro, com companhia, hora (do local do evento), stand e participantes. Os colegas da ANA vão para «Participantes ANA»; as pessoas da companhia aparecem como atalho para criar o contacto. As canceladas ficam de fora (ou são marcadas, se já tiverem notas). A agenda volta a ser lida sozinha ao abrir a app (no máximo de 15 em 15 minutos) e há um botão ↻ no ecrã principal para a ler na hora; uma reunião apagada no Debrief não volta a aparecer. Reuniões em comum com o colega não se duplicam.

## Lista e eventos

A lista abre em **Pendentes**: reuniões agendadas (confirmadas, por aceitar, por confirmar, por registar), rascunhos e alteradas após exportar. As concluídas, exportadas e canceladas ficam escondidas; vês todas em **Todas** ou no filtro de cada estado.

**Eventos** (Routes World, feiras, roadshows): cria-os em Definições → Eventos, na própria reunião (campo **Evento**) ou, no portátil, selecionando várias reuniões na lista → **Evento**. Cada evento tem nome, datas, local e, opcionalmente, o **Type of Tradeshow**, que passa para as reuniões que ainda não o têm. Ao criar um evento com datas, podes associar logo as reuniões dessas datas; as reuniões novas (e as que chegam da agenda) dentro das datas de um evento ficam associadas sozinhas. Filtra a lista por evento (no telemóvel, na linha de cima). Os eventos são partilhados com o colega.

## Diretório Salesforce

Cópia de todos os contactos do Salesforce, só para consulta e separada dos teus Contactos. Serve para encontrar uma pessoa pelo nome: aparece quando pesquisas em Contactos, ao juntar um contacto a uma reunião (secção «Diretório Salesforce») e ao criar um contacto ou ler um cartão («Completar», que também liga o ID do contacto 003…). No Salesforce, a janela da reunião sugere a conta certa (001…) a partir do diretório. O «Perguntar» também procura lá.

Montar uma vez: corre `supabase/06_diretorio.sql` no SQL Editor do Supabase do Portal. Depois, e sempre que quiseres atualizar: no Salesforce, relatório «Contactos para o Debrief» (Contacts & Accounts, todos os contactos, colunas Contact ID, First/Last Name, Account Name, Account ID, Title, Email, Phone, Mobile, BU, Last Modified Date) → Export → Details Only → CSV; no Debrief, Definições → Diretório Salesforce → **Importar CSV**. A importação substitui o diretório para os dois. Os dados ficam no Supabase (só com login) e no dispositivo; nunca neste repositório.

## Schedule (época IATA)

Menu **Schedule W26** (no telemóvel, separador «Schedule»): procura um aeroporto, cidade ou país e vês se há voos do Porto, as companhias, quantos voos por semana, em que dias (círculos S T Q Q S S D: cheio = todas as semanas, tracejado = algumas, ×2 = dois voos no dia), as horas de partida, o avião, o período e o total da época. Sem pesquisa, a lista mostra os destinos com mais voos primeiro. Conta-se por partidas do Porto (ida e volta = 1 voo); os voos pontuais e charters aparecem à parte.

Os dados vêm do relatório «Schedule Report By Day» (xlsx) e são resumidos com `tools/schedule.py` para a tabela `crm_referencia` (chave `schedule`), só com login; ficam guardados no dispositivo para funcionar sem rede. Nunca ficam neste repositório. Para uma época nova: `python3 -I tools/schedule.py relatorio.xlsx S27 2027-03-28 2027-10-30 > schedule.json` e grava o JSON em `crm_referencia` (chave `schedule`).

## Definições

Em cima: a conta (sincronizar, sair), o teu nome e o **Aspeto** (Claro, Escuro ou Sistema; guardado só neste dispositivo). O resto está em grupos que abres quando precisas: Agenda, Eventos, Temas das reuniões, Salesforce (endereço, Subject, Scope e contas das companhias), Diretório Salesforce, Inteligência artificial e Dados e cópias.

## Novidades

Depois de cada atualização aparece um cartão com as novidades da versão (só uma vez em cada dispositivo). A lista completa está em Definições → **novidades** (ao lado do número da versão) ou no rodapé do menu. Ao publicar uma versão nova, junta-a no topo de `NOVIDADES` em `index.html`.

## Partilhar com o colega (Supabase do Portal)

As reuniões, contactos e fotos ficam numa base partilhada no Supabase do Portal do Lounge (UE). Cada dispositivo guarda uma cópia para trabalhar sem rede e sincroniza sozinho quando volta a ter rede (e em tempo real enquanto a app está aberta).

Configuração (uma vez):
1. No Supabase do Portal, SQL Editor → corre `supabase/01_crm_reunioes.sql`. Só acrescenta uma tabela, uma pasta privada de fotos e regras de acesso; não mexe no Portal.
2. Corre `supabase/02_dar_acesso.sql` com o teu email e depois com o do teu colega. Só quem tiver esta permissão vê as reuniões — os outros administradores do Portal não.
3. Abre o Debrief e entra com a conta do Portal.

Os dados que já tens no dispositivo são enviados na primeira vez que entras.

## Leitura com IA (Claude)

Com rede e sessão iniciada, as fotos de notas manuscritas e os cartões de visita são lidos pelo Claude (Sonnet), que lê letra à mão muito melhor do que o leitor do dispositivo. Sem rede, ou se a IA falhar, a leitura é feita no dispositivo como antes. Pode ser desligada em Definições → Predefinições.

A chave da API do Claude **nunca** está na app (o código é público): fica nos segredos do Supabase e só a função `debrief-ler` a usa. A função só aceita quem tem sessão e a permissão das reuniões. As fotos são enviadas ao Claude só para leitura e não ficam guardadas na função.

Configuração (uma vez):
1. Em console.anthropic.com → *API keys*, cria uma chave (ex.: «Debrief»). Em *Limits*, define um limite mensal de gastos.
2. No Supabase do Portal → *Edge Functions* → *Secrets* → *Add new secret*: nome `ANTHROPIC_API_KEY`, valor = a chave.
3. A função `debrief-ler` (código em `supabase/functions/debrief-ler/`) tem de estar publicada em *Edge Functions*.

Custo aproximado: ~0,015 USD por foto de notas com o Sonnet.

## Preparação da reunião (notícias)

Em cada reunião há uma secção **Preparação**: notícias da companhia que contam para a negociação (frota, rotas, finanças, estratégia, operações, Portugal), cada uma com «porque importa» para o aeroporto, pontos para levar à reunião e o resumo das reuniões anteriores com essa companhia. Fica guardada por companhia (partilhada com o colega) e disponível sem rede depois de aberta; ↻ atualiza.

Fontes: CAPA (RSS da subscrição), Aeroroutes, AeroTime, Simple Flying, FlightGlobal, Airlines (IATA), anna.aero, Air Service One, aeroTELEGRAPH, AirlineGeeks, Aviation24.be, Aviación al Día, Ambitur, Preferente, Hosteltur, Jornal de Negócios, ECO e Google News. Uma tarefa no Supabase lê os feeds de hora a hora e guarda-os (200 dias), por isso o histórico vai crescendo. O Claude Sonnet escolhe e resume (~0,05 USD por preparação). Aeroportos concorrentes em Definições → Predefinições.

Configuração (uma vez):
1. SQL Editor → corre `supabase/03_preparacao.sql` (arquivo de notícias, preparações e a tarefa de hora a hora).
2. Edge Functions → Secrets → `CAPA_RSS_URL` = endereço do feed RSS do CAPA (vários: um por linha). Não o ponhas no código: costuma ter um código pessoal.
3. A função `debrief-noticias` (código em `supabase/functions/debrief-noticias/`) tem de estar publicada.

## Simulação da rota (taxas e incentivos)

Em cada reunião, **Simular rota**: escolhes a aeronave (primeiro as que a companhia usa), voos por semana, load factor, hora de partida, início e tipo de incentivo (nova rota ou 2.ª companhia em monopólio). Mostra o incentivo Non-Based (ano 1, ano 2, por passageiro, épocas não elegíveis), as taxas por rotação e no período, as taxas ANA líquidas de incentivo e a mesma rotação em Lisboa e Faro. **Guardar** deixa a simulação na reunião (partilhada com o colega) e entra na Preparação das reuniões seguintes. «Vista para a companhia» tira a modulação interna por ruído.

O motor de cálculo é o do Simulador de Taxas 2026. As **tabelas** (taxas, incentivos, fatores de ruído e tipos de aeronave) não estão neste repositório: ficam no Supabase, só para quem tem login, e o Debrief guarda uma cópia no dispositivo para funcionar sem rede.

Configuração (uma vez, e de novo quando houver tabelas novas): SQL Editor → corre o ficheiro `04_simulador_dados.sql` (enviado à parte, não está no GitHub). A estrutura da tabela está em `supabase/04_simulador.sql`.

## Perguntar (Claude)

**Perguntar** (menu lateral, ícone de conversa no topo da lista, ou dentro de uma reunião): conversa com o Claude sobre as reuniões (tuas e do colega), contactos, preparações, arquivo de notícias e o simulador de taxas e incentivos. O Claude pede os dados ao Debrief através de ferramentas que correm no dispositivo, por isso só segue para o Claude o que a pergunta precisa. Para valores de taxas e incentivos usa sempre o simulador. O globo liga a pesquisa na web. As respostas podem ser copiadas ou juntadas às notas da reunião. O Claude só lê: não altera dados nem envia nada.

As conversas são **privadas**: ficam no dispositivo e na tabela `crm_conversas`, onde cada pessoa só vê as suas. Configuração (uma vez): SQL Editor → corre `supabase/05_conversas.sql`. A função `debrief-chat` (código em `supabase/functions/debrief-chat/`) usa a mesma chave do Claude.

## Passar do telemóvel para o portátil

Com a conta do Portal isto já é automático. Sem conta: Exportar → **Exportar cópia** (ficheiro `.json` com tudo, incluindo fotos) → envia para ti (AirDrop, email, Files) → no portátil, Exportar → **Importar cópia**. Junta sem duplicar.

Faz cópias regularmente: se o browser for limpo, os dados perdem-se.

## Importação em massa (Data Loader — desligada)

Escondida na app (`DATALOADER = false` em `index.html`), porque não há acesso API ao Salesforce. Para voltar a mostrar, muda para `true`.

### Como funcionava

Exportar → **Meeting Notes para o Data Loader** gera um CSV para `Insert` no objeto `Task`. Antes da primeira vez, pede ao administrador do Salesforce:

- o ID do tipo de registo «Meeting Note» (começa por `012`);
- os nomes API dos campos Flag, Type of Tradeshow e Geographical Scope;

e coloca-os em Definições → Importação com Data Loader. O ID de cada conta (`001…`) vai em Definições → Companhias.

Contactos novos: **Contactos para o Assistente de Importação** (CSV para *Contas e Contactos*, associação pelo nome da conta).

## Componentes de terceiros

Leitura sem rede: [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), incluído em `vendor/ocr/`.
