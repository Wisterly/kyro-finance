# Diagnóstico Técnico: Bot WhatsApp KYRO Finance

Documento técnico elaborado com base na auditoria direta do código-fonte do repositório `kyro-finance`.

---

## 1. Arquitetura Geral

### Serviços que compõem o sistema
* **Vercel:** Hospeda a aplicação web (SPA React + Vite + Tailwind CSS) e as Serverless Functions (`/api/webhook.ts`, `/api/chat.ts`, `/api/database.ts`). Responsável pela interface do usuário, APIs REST e regras de negócio serverless.
* **Render (ou Execução Local):** Hospeda o processo Node.js contínuo de background (`bot.cjs`), que executa o cliente Baileys (`@whiskeysockets/baileys`). Esse processo mantém uma conexão WebSocket aberta com os servidores do WhatsApp.
* **Firebase / Firestore:** Banco de dados NoSQL em nuvem (opcional/híbrido) suportado em `api/services/financeDb.ts` e `src/firebase.ts`. O sistema também opera com persistência JSON (`transactions.json`) e sincronização via `/api/database.ts`.
* **Provedores de Inteligência Artificial (Opcionais):**
  * **OpenAI:** Suporte a Whisper-1 (áudio) e GPT-4o-mini via `OPENAI_API_KEY`.
  * **Groq Cloud:** Suporte a Whisper-large-v3 de baixa latência via `GROQ_API_KEY`.
  * **Google Gemini:** Suporte a modelos multimodais via `GEMINI_API_KEY`.
  * **Motor Local Gratuito (Embutido no `bot.cjs`):** Extrator heurístico neural regex em português, Tesseract OCR local e Transformers Whisper local (opera com R$ 0 de custo em APIs externas).

### Caminho completo de uma mensagem (do envio ao dashboard)
1. O usuário envia uma mensagem de texto, áudio ou foto de comprovante no grupo oficial do WhatsApp.
2. O cliente Baileys no `bot.cjs` intercepta o evento via WebSocket (`sock.ev.on('messages.upsert')`).
3. O `bot.cjs` aplica o filtro de segurança de remetente, aceitando apenas mensagens originadas do grupo autorizado (definido em `kyro_settings.json` ou `monitored_group.json`).
4. Caso a mensagem contenha áudio, o `bot.cjs` transcreve o conteúdo (localmente ou via Groq/Gemini). Se for imagem, extrai o texto através de OCR (Tesseract).
5. O `bot.cjs` despacha um POST HTTP contendo o payload tratado para o endpoint serverless da Vercel: `https://kyro-finance.vercel.app/api/webhook` (com fallback para `http://localhost:3000/api/webhook`).
6. O arquivo `api/webhook.ts` analisa os dados financeiros e persiste o registro no banco central (Firestore ou estado persistente via `api/database.ts`).
7. O `bot.cjs` recebe a confirmação da Vercel e envia a resposta formatada de volta no grupo do WhatsApp.
8. O Dashboard web (`src/App.tsx`), conectado via Firebase `onSnapshot` e polling periódico para `/api/database`, recebe o novo registro e recalcula instantaneamente saldo, gráficos e categorias.

### Divisão de Cargas: Vercel vs Render
* **Vercel:** Interface estática compilada (`dist/`) e Serverless Functions de curta duração. **Não** executa processos contínuos de background nem conexões WebSocket persistentes.
* **Render (ou Ambiente Local):** Processo contínuo Node.js que mantém o WebSocket do WhatsApp ativo 24/7.

---

## 2. O Arquivo `bot.cjs`

### Inicialização e Manutenção da Conexão
* A conexão é iniciada pela função `startSocket()` utilizando `makeWASocket()` da biblioteca `@whiskeysockets/baileys`.
* O estado de autenticação utiliza `useMultiFileAuthState(authFolder)` apontando para a pasta local `auth_info_baileys`.
* Configuração de navegador: `Browsers.ubuntu('Chrome')`.
* Parâmetros de timeout: `connectTimeoutMs: 60000`, `defaultQueryTimeoutMs: 60000`, `keepAliveIntervalMs: 25000`.

### Tratamento de Desconexão e Reconexão Automática
Implementado no listener `sock.ev.on('connection.update')`:
```javascript
} else if (connection === 'close') {
  botStatus.connected = false;
  const statusCode = (lastDisconnect?.error)?.output?.statusCode;
  const isInvalidSession = 
    statusCode === DisconnectReason.loggedOut || 
    statusCode === 401 || 
    statusCode === 403 || 
    statusCode === 405;

  console.log(`⚠️ [WhatsApp] Conexão encerrada (Status: ${statusCode}). Sessão inválida: ${isInvalidSession}`);
  if (!isInvalidSession) {
    setTimeout(startSocket, 3000);
  } else {
    console.log('🔄 Limpando credenciais antigas para gerar novo QR Code Oficial do WhatsApp Web...');
    try {
      fs.rmSync(authFolder, { recursive: true, force: true });
    } catch (e) {}
    setTimeout(startSocket, 2000);
  }
}
```

### Casos de Desistência / Reset de Sessão
Caso o código retorne `statusCode === DisconnectReason.loggedOut` ou erros `401`, `403` ou `405`, o código considera a sessão permanentemente invalidada pelo WhatsApp, exclui a pasta `auth_info_baileys` e reinicia o socket gerando um **novo QR Code**, exigindo nova leitura manual.

### Servidor HTTP no `bot.cjs`
Sim, existe um servidor HTTP nativo (`http.createServer()`) ouvindo na porta definida por `process.env.BOT_PORT || process.env.PORT || 3001` (no Render, a porta padrão configurada é `10000`).

### Rotas HTTP Existentes
* `GET /api/health`, `/healthz`, `/ping`
* `GET /api/stream` (Server-Sent Events)
* `GET /api/status`
* `GET /api/groups`
* `GET /api/benchmark`
* `POST /api/transcribe`
* `GET /api/webhook` e `POST /api/webhook`
* `POST /api/request-code`
* `POST /api/disconnect` e `POST /api/reset-qr`
* `GET /api/transactions` e `POST /api/transactions`
* `POST /api/set-group`
* `GET /api/monitored-group`
* `GET /api/database` e `POST /api/database`
* `POST /api/chat`

### Rota de Health Check
**SIM, EXISTE.** A rota `GET /api/health` (bem como `/healthz` e `/ping`) está implementada na linha 3196 e responde status `200` com payload JSON contendo `status: 'ok'`, `uptime`, `connected`, `phoneNumber`, `monitoredGroup` e `timestamp`.

---

## 3. Sessão do WhatsApp

### Local de Armazenamento
Os dados de sessão ficam gravados no diretório local `path.join(__dirname, 'auth_info_baileys')` no container/servidor.

### Persistência no Render
**NÃO PERSISTE.** No plano gratuito do Render, o sistema de arquivos é **efêmero (ephemeral)**. Sempre que o serviço entra em hibernação profunda ou reinicia, qualquer arquivo gerado em disco durante a execução é permanentemente descartado. Não há disco persistente configurado.

### Sincronização em Nuvem (Firebase/Vercel)
O `bot.cjs` possui as funções `syncBaileysCredsToCloud()` e `restoreBaileysCredsFromCloud()`, que tentam enviar e restaurar exclusivamente o arquivo `creds.json` via endpoint `/api/database` na Vercel. Todavia, a biblioteca Baileys necessita de dezenas de arquivos auxiliares de chaves criptográficas (`app-state-sync`, `pre-keys`, etc.) presentes na pasta `auth_info_baileys`. Restaurar apenas o `creds.json` sem as pre-keys completas resulta frequentemente em erros de decodificação do protocolo Signal (status 401/408).

### Comportamento no Reinício do Render
Ao reiniciar após hibernação ou novo deploy, o container inicia sem os arquivos criptográficos completos. O Baileys não consegue restabelecer o handshake prévio, aciona o fluxo de sessão expirada/fechada e gera um novo QR Code, deixando o bot inativo até que um novo pareamento seja executado.

---

## 4. Configuração do Render

### Conteúdo do `render.yaml`
```yaml
services:
  - type: web
    name: kyro-whatsapp-bot
    runtime: node
    plan: free
    region: oregon
    buildCommand: npm install --legacy-peer-deps
    startCommand: node bot.cjs
    envVars:
      - key: NODE_VERSION
        value: 20.10.0
      - key: BOT_PORT
        value: "10000"
      - key: REMOTE_WEBHOOK_URL
        value: https://kyro-finance.vercel.app/api/webhook
```

### Especificações do Serviço
* **Plano:** `free`.
* **Tipo de Serviço:** `web` (Web Service).
* **Build Command:** `npm install --legacy-peer-deps`.
* **Start Command:** `node bot.cjs`.
* **Disco Persistente:** **NÃO EXISTE NO CÓDIGO** (disponível apenas em planos pagos no Render).
* **Hibernação por Inatividade:** **SIM.** Serviços web gratuitos no Render entram em hibernação compulsória após **15 minutos** sem receber requisições HTTP públicas entrantes.

---

## 5. Prevenção da Hibernação

### Endpoint para Monitoramento Externo
Serviços como UptimeRobot ou cron-job.org podem realizar chamadas periódicas no endpoint existente:
`https://<nome-do-servico>.onrender.com/api/health`

### Necessidade de Criação
**Não é necessário criar nada novo.** A rota já está funcional no código do `bot.cjs`.

### Limite de Horas Gratuitas no Render
O Render disponibiliza **750 horas gratuitas por mês por conta** para instâncias free.
* Um mês de 31 dias totaliza `744 horas` (`31 * 24`).
* **Conclusão Técnica:** Se a conta possuir **apenas 1 serviço web ativo**, 744 horas cabem no limite de 750 horas. No entanto, havendo qualquer outro serviço consumindo horas na mesma conta, o limite é ultrapassado e o Render suspende a execução até a virada do ciclo mensal.

---

## 6. Variáveis de Ambiente

### Relação de Variáveis Utilizadas no Código
* `PORT` / `BOT_PORT` (Render / Local)
* `REMOTE_WEBHOOK_URL` (Render / Local)
* `NODE_VERSION` (Render)
* `GEMINI_API_KEY` (Render / Vercel / Local)
* `GROQ_API_KEY` (Render / Vercel / Local)
* `OPENAI_API_KEY` (Render / Vercel / Local)
* `EVOLUTION_SERVER_URL` (Legado / Descontinuado pelo bot nativo Baileys)
* `EVOLUTION_API_KEY` (Legado / Descontinuado pelo bot nativo Baileys)
* `EVOLUTION_INSTANCE` (Legado / Descontinuado pelo bot nativo Baileys)
* `VITE_FIREBASE_*` (Vercel / Local)

### Variáveis Desnecessárias ou Mal Configuradas
As variáveis com prefixo `EVOLUTION_*` constam em `.env.example`, porém o bot foi refatorado para utilizar conexão nativa Baileys direta, não utilizando mais instâncias externas da Evolution API.

---

## 7. Logs e Tratamento de Erros

### Mensagens Típicas de Log
* Sucesso na conexão: `🎉 [WhatsApp] CONECTADO COM SUCESSO! Número: <telefone>`
* Geração de QR: `📲 [WhatsApp Web] Novo QR Code Oficial gerado e disponível para leitura!`
* Queda de conexão: `⚠️ [WhatsApp] Conexão encerrada (Status: <código>). Sessão inválida: <boolean>`
* Recebimento de dados: `📩 [Finanças Kyro] Mensagem recebida: "<texto>"`

### Pontos Críticos de Falha Silenciosa
* **Nível de Log Oculto:** O Baileys é inicializado com `logger: pino({ level: 'silent' })`. Falhas de handshake e timeouts internos não emitem stack trace no console.
* **Isolamento de Erros Globais:** O processo contém listeners para `uncaughtException` e `unhandledRejection`. Isso impede que o Node.js aborte a execução em falhas pontuais, mas não protege contra a terminação do container pelo orquestrador do Render por falta de tráfego HTTP.

---

## 8. Avaliação Técnica e Diagnóstico de Causa Raiz

### Causa Raiz do Problema
**O bot para de responder porque o Render suspende o container após 15 minutos sem requisições HTTP entrantes.**
1. O Render monitora unicamente requisições HTTP recebidas na porta pública do serviço. Mensagens do WhatsApp chegam através de uma conexão **WebSocket de saída** mantida com os servidores da Meta, o que o Render **não contabiliza como tráfego HTTP entrante**.
2. Passados 15 minutos, o Render congela a CPU do container e encerra os sockets ativos.
3. Quando o usuário envia uma mensagem no WhatsApp, o bot já está inativo e desconectado da rede, impedindo qualquer disparo para os logs da Vercel.
4. Quando uma requisição externa finalmente acorda o Render, o container é recriado do zero sobre um disco efêmero limpo, sem as chaves da pasta `auth_info_baileys`, exigindo um novo QR Code.

### Alternativas de Resolução (Custo R$ 0)

1. **Abordagem 1: Keep-Alive HTTP Externo (Esforço: 5 min | Custo: R$ 0)**
   * Configurar um monitor gratuito no [cron-job.org](https://cron-job.org) ou [UptimeRobot](https://uptimerobot.com) enviando uma requisição HTTP GET para `https://<seu-servico>.onrender.com/api/health` a cada **10 minutos**.
   * *Atenção:* Exige que a conta do Render possua exclusivamente este serviço para não estourar as 750 horas gratuitas mensais.

2. **Abordagem 2: Execução Local Dedicada (Esforço: Imediato | Custo: R$ 0)**
   * Executar o bot localmente através do arquivo `iniciar_robo.bat`.
   * A pasta `auth_info_baileys` permanece gravada no disco rígido local, eliminando perda de sessão e hibernação.

3. **Abordagem 3: Hospedagem Gratuita com Disco Persistente ou Sem Sleep (Esforço: 20 min | Custo: R$ 0)**
   * **Oracle Cloud Free Tier:** Provisionar uma máquina virtual permanente gratuita (Always Free Compute VM no Ubuntu com 1 OCPU e IP público fixo), executando o `bot.cjs` via PM2 ou Docker.
   * Por se tratar de um servidor Linux dedicado e permanente, o disco nunca se perde, o WebSocket nunca dorme e a estabilidade atinge 100% de disponibilidade a custo zero.
