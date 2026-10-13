# 🚀 Kyro Private Finance + WhatsApp AI Agent

Sistema completo de controle financeiro pessoal com dashboard em tempo real e agente inteligente no WhatsApp powered by **OpenAI (GPT-4o-mini)**, **Evolution API** e **Firebase/Firestore**.

Projetado para ser hospedado diretamente na **Vercel** com Serverless Functions.

---

## 🏗️ Arquitetura da Solução

```
                    ┌─────────────────────────┐
                    │   WhatsApp do Usuário   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │      Evolution API      │
                    │ (Instância de WhatsApp) │
                    └────────────┬────────────┘
                                 │ Webhook (POST)
                                 ▼
     ┌───────────────────────────────────────────────────────┐
     │                     VERCEL                            │
     │                                                       │
     │  ┌───────────────────────┐   ┌──────────────────────┐ │
     │  │ /api/webhook.ts       │   │ /api/chat.ts         │ │
     │  │ (Recebe do WhatsApp)  │   │ (Chat do Painel Web) │ │
     │  └───────────┬───────────┘   └──────────┬───────────┘ │
     │              │                          │             │
     │              ▼                          ▼             │
     │  ┌──────────────────────────────────────────────────┐ │
     │  │  OpenAI GPT-4o-mini com Function Calling         │ │
     │  │  (Extrai valor, tipo, categoria, cidade, método) │ │
     │  └───────────────────────┬──────────────────────────┘ │
     │                          │                            │
     │                          ▼                            │
     │  ┌──────────────────────────────────────────────────┐ │
     │  │  Firebase Firestore (kyro_transactions)          │ │
     │  └───────────────────────┬──────────────────────────┘ │
     │                          │                            │
     │                          ▼                            │
     │  ┌──────────────────────────────────────────────────┐ │
     │  │  Front-end React + Vite + Tailwind (Dashboard)   │ │
     │  │  (Atualização em tempo real via onSnapshot)      │ │
     │  └──────────────────────────────────────────────────┘ │
     └───────────────────────────────────────────────────────┘
```

---

## 📂 Estrutura de Arquivos

- **`/api`**: Serverless Functions da Vercel
  - `webhook.ts`: Recebe os eventos de mensagens e áudios enviados pelo WhatsApp.
  - `chat.ts`: Processa as mensagens com o cérebro financeiro da OpenAI e Function Calling.
  - `prompts/finance.prompt.ts`: Instruções especializadas do Copiloto Financeiro.
  - `services/evolution.ts`: Cliente HTTP para envio de respostas automáticas no WhatsApp.
  - `services/financeDb.ts`: Gravação e consulta direta no banco de dados Firestore.
- **`/src`**: Aplicação Front-end (React, TypeScript, TailwindCSS)
  - `firebase.ts`: Conexão em tempo real do painel com o Firestore.
  - `App.tsx`: Dashboard financeiro, gráficos, métricas, modais e chat interativo.
- **`vercel.json`**: Configuração de roteamento automático e SPA para a Vercel.

---

## ⚙️ Variáveis de Ambiente na Vercel

Ao importar o repositório na **Vercel** (`Settings > Environment Variables`), adicione as seguintes variáveis:

### 1. OpenAI
- `OPENAI_API_KEY`: Sua chave de API da OpenAI (`sk-...`).

### 2. Evolution API (WhatsApp)
- `EVOLUTION_SERVER_URL`: URL da sua Evolution API (ex: `https://seu-servidor-evolution.com`).
- `EVOLUTION_API_KEY`: Chave de autenticação da Evolution API.
- `EVOLUTION_INSTANCE`: Nome da instância conectada ao WhatsApp.

### 3. Firebase (Banco de Dados em Tempo Real)
- `VITE_FIREBASE_API_KEY`: API Key do seu projeto Firebase.
- `VITE_FIREBASE_AUTH_DOMAIN`: `seu-projeto.firebaseapp.com`
- `VITE_FIREBASE_PROJECT_ID`: ID do projeto no Firebase.
- `VITE_FIREBASE_STORAGE_BUCKET`: `seu-projeto.appspot.com`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`: Sender ID do Firebase.
- `VITE_FIREBASE_APP_ID`: App ID do Firebase.

---

## 📲 Configuração do Webhook na Evolution API

No painel ou via API da sua **Evolution API**, configure o webhook da sua instância apontando para a URL gerada pela Vercel:

- **Webhook URL**: `https://seu-projeto.vercel.app/api/webhook`
- **Webhook By Events**: Ativar
- **Eventos selecionados**: `MESSAGES_UPSERT`

---

## 💬 Exemplos de Uso no WhatsApp

Assim que o webhook estiver configurado, você pode mandar no WhatsApp:

- *"Gastei 45 no pix na padaria em Teresina"*
- *"Paguei 320 no cartão de crédito no supermercado em Caxias"*
- *"Recebi 6000 de salário"*
- *"Comprei tênis de 190 no débito em Oeiras"*

O agente responde no WhatsApp confirmando os dados e a transação **aparece automaticamente em tempo real na tela do site**!
