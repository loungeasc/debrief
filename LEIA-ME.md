# Debrief — notas de reuniões com companhias

App para registar reuniões com companhias aéreas logo a seguir à reunião (telemóvel) e passar para o Salesforce como **New Meeting Note** (portátil ou telemóvel).

Os dados ficam **só no dispositivo** (base de dados local do browser). A leitura dos cartões de visita também é feita no próprio dispositivo — nenhuma imagem é enviada para fora.

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

1. **+** → companhia → **Cartão de visita** (fotografa; os dados são lidos automaticamente) → temas (um parágrafo por tema) → fotos das notas → **Marcar como pronta**.
2. No Salesforce: conta da companhia → **New Meeting Note**. No Debrief, toca em **Salesforce** e copia cada campo pela ordem do formulário (Subject, Name, Related To, Due Date, Flag, Type of Tradeshow, Geographical Scope, Comments).
3. **Já gravei — marcar exportada.**

Subject automático: `Meeting_OPO_<código IATA>_<temas>` (prefixo e aeroporto em Definições).

## Passar do telemóvel para o portátil

Exportar → **Exportar cópia** (ficheiro `.json` com tudo, incluindo fotos) → envia para ti (AirDrop, email, Files) → no portátil, Exportar → **Importar cópia**. Junta sem duplicar.

Faz cópias regularmente: se o browser for limpo, os dados perdem-se.

## Importação em massa (opcional, Data Loader)

Exportar → **Meeting Notes para o Data Loader** gera um CSV para `Insert` no objeto `Task`. Antes da primeira vez, pede ao administrador do Salesforce:

- o ID do tipo de registo «Meeting Note» (começa por `012`);
- os nomes API dos campos Flag, Type of Tradeshow e Geographical Scope;

e coloca-os em Definições → Importação com Data Loader. O ID de cada conta (`001…`) vai em Definições → Companhias.

Contactos novos: **Contactos para o Assistente de Importação** (CSV para *Contas e Contactos*, associação pelo nome da conta).

## Componentes de terceiros

Leitura de cartões: [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), incluído em `vendor/ocr/`.
