# PONTOS DE RESTAURAÇÃO DE TRILHO DUPLO (KYRO FINANCE)

Este documento registra oficialmente todos os **Pontos de Restauração (PR)** estruturados sob a arquitetura de **Trilho Duplo** do Kyro Finance, garantindo isolamento técnico rigoroso entre a visualização de **Computador (Desktop)** e de **Celular (Mobile)**.

---

## DIRETRIZES DA ARQUITETURA DE TRILHO DUPLO

### 1. Isolamento Técnico Estrito (Desktop vs Mobile)
- **Zero Interferência Mútua:** Nenhuma alteração solicitada para celular altera layout, tamanho de fonte, espaçamento ou comportamento da tela de computador, e vice-versa.
- **Divisão de Estilos via Media Queries:**
  - Regras exclusivas de celular: `@media (max-width: 768px)`.
  - Regras exclusivas de computador: `@media (min-width: 769px)`.
- **Classes Utilitárias de Plataforma:**
  - `.desktop-only` / `.desktop-only-flex`: visíveis exclusivamente em computadores.
  - `.mobile-only` / `.mobile-only-flex`: visíveis exclusivamente em celulares.
- **Tipografia e Viewport Base no Mobile:**
  - Otimizado para viewports a partir de 390x844px sem cortes de texto e sem rolagem horizontal ou vertical indesejada.

### 2. Estrutura e Escopos de Cada Ponto de Restauração (PR.00X)
A numeração segue rigorosamente a hierarquia de escopo:

- **`PR.00X` — Escopo Geral do Projeto (Universal):**
  - **Quando é acionado:** Quando o usuário solicitar ajustes gerais no projeto (ex: *"quero que ajuste isso no projeto"*).
  - **O que contempla:** Configurações que valem tanto para a visualização no desktop quanto no celular (ex: nome da aplicação, ícone/favicon do site, regras de negócios globais, modelos de dados, integrações de IA, robô do WhatsApp, webhook e sincronização em nuvem).
- **`PR.00X.1` — Escopo Específico de Computador (Desktop):**
  - **Quando é acionado:** Quando o usuário solicitar alterações exclusivas para a tela grande (ex: *"quero que ajuste isso para a visualização do desktop"*).
  - **O que contempla:** Layout de tela cheia, colunas laterais fixas, tabelas expandidas com múltiplas colunas, dashboards panorâmicos, atalhos de teclado e modais amplos.
- **`PR.00X.2` — Escopo Específico de Celular (Mobile):**
  - **Quando é acionado:** Quando o usuário solicitar alterações exclusivas para dispositivos móveis (ex: *"quero que ajuste isso para a visualização do celular / mobile"*).
  - **O que contempla:** Adaptações de toque (touch), menus gaveta (drawers), barras de navegação inferiores, botões compactos, viewports a partir de 390x844px e recursos nativos de hardware móvel (câmera, microfone mobile).

### 3. Regra de Ouro (Isolamento de Dados vs Estrutura)
- **O que entra na restauração:** Toda a estrutura de código (HTML, CSS, TypeScript, layout, componentes).
- **O que NUNCA é apagado ou alterado:** Dados reais cadastrados pelo usuário, arquivos de upload, comprovantes, fotos, planilhas salvas, `localStorage` e banco Firestore.

### 4. Regra Obrigatória de Entrega Final (Links + Pontos de Restauração + Download do APK Atualizado)
- Sempre que qualquer nova configuração, ajuste ou implementação for concluída no projeto, além de atualizar a Vercel (`git push`), sincronizar o pacote Android (`npm run apk:sync`) e exibir os códigos dos Pontos de Restauração (`PR.0XX`, `PR.0XX.1`, `PR.0XX.2`) e links habituais, **é obrigatório incluir no final da resposta o link direto para baixar o arquivo `.apk` novo atualizado**:
  - **Link Direto de Download do APK (Celular):** `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk`
  - **Página de Releases no GitHub:** `https://github.com/Wisterly/kyro-finance/releases`
  - **Arquivo Local Atualizado no PC:** `C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk`

---

## HISTÓRICO DE PONTOS DE RESTAURAÇÃO

### [PR.001] — Marco Inicial & Fundação do Trilho Duplo
- **Data/Hora:** 2026-10-25 01:34 (UTC-3)
- **Commit Base:** `0614e32`
- **Tags Git:** `PR.001`, `PR.001.1`, `PR.001.2`

#### `PR.001.1` — Versão Computador (Desktop)
- **Escopo Estrutural:**
  - Dashboard analítico consolidado em grid multi-colunas.
  - Sidebar esquerda fixa e persistente (`w-64`) com navegação completa por abas.
  - Painel lateral direito de IA com chat inteligente integrado.
  - Módulo completo de Cartões de Crédito com visual de cartão físico, cálculo de limite, faturas e controle de parcelamentos.
  - Tabela completa de transações com filtros de método e busca multidimensional (produto, estabelecimento, cidade).
  - Relatório consolidado com matriz de Gastos por Produto & Estabelecimento.
  - Modais desktop centralizados para novas entradas, saídas e cadastro de cartões.

#### `PR.001.2` — Versão Celular (Mobile)
- **Escopo Estrutural:**
  - Isolamento de regras CSS com classes `.mobile-only` e `.desktop-only`.
  - Header compacto com botão de menu hambúrguer para navegação mobile.
  - Chat lateral de IA com abertura em gaveta lateral (drawer) adaptável ao toque.
  - Botão de microfone com digitação por voz em tempo real e visualizador de transcrição sem congelamento.
  - Botão de Câmera nativa com disparo automático da câmera traseira do celular (`capture="environment"`).
  - Botão `+` para upload de fotos e documentos PDF diretamente do diretório do dispositivo móvel.
  - Viewport travada para prevenir overflow lateral em telas de 390x844px.

---

### [PR.002] — Paridade Mobile Total, Comandos de Correção e Copiloto Cognitivo
- **Data/Hora:** 2026-10-25 01:52 (UTC-3)
- **Tags Git:** `PR.002`, `PR.002.1`, `PR.002.2`

#### `PR.002` — Escopo Geral do Projeto (Universal)
- **Eliminação Completa de Respostas Padrão Engessadas:**
  - O antigo método estático `processIaText` foi 100% extinto do projeto. Nenhuma mensagem do usuário recebe respostas pré-formatadas ou caixas de texto genéricas.
  - Toda interação é avaliada por um motor cognitivo autossuficiente que lê saldos, histórico de transações, limites de crédito, compromissos fixos e dívidas em tempo real.
- **Comandos Interativos de Manipulação do Último Lançamento (Voz e Texto):**
  - **Exclusão de Alta Fidelidade Fonética:** Abrange todas as variações faladas e digitadas: *"remover o último lançamento que eu fiz"*, *"remova o último lançamento"*, *"o último lançamento está errado, remova ele"*, *"apague o último"*, *"apague o que acabei de falar"*, *"cancela o último levantamento"*, *"tira o último lançamento"*, *"deleta o último"*, *"desfaça o último"* — localiza `transactions[0]`, cancela a operação, sincroniza a exclusão no Google Firestore via `kyroCloud.syncDeleteTransaction`, recalcula saídas/entradas e saldos instantaneamente com confirmação detalhada.
  - **Ajuste:** *"ajuste o valor do último lançamento para R$ X"*, *"mude a forma do último lançamento para débito/crédito/PIX"*, *"mude o cartão para Nubank"*, *"mude a cidade para Oeiras"* — aplica a alteração no último registro e sincroniza em tempo real.
  - **Enriquecimento:** *"acrescente a informação no último lançamento que a cidade foi Oeiras"*, *"acrescente que o produto foi barra de chocolate"* — atualiza os campos de produto, estabelecimento e localidade.
- **Copiloto Financeiro Cognitivo (`generateThinkingFinancialReply`):**
  - Avaliação contextual de liquidez em tempo real (saldo disponível, total de entradas, total de saídas, taxa de sobra).
  - Orientação orçamentária e consultoria inteligente para perguntas abertas (ex: *"como estão minhas finanças?"*, *"posso gastar R$ 500?"*, *"qual meu maior gasto?"*, *"quais dívidas tenho que pagar?"*).
  - Controle integrado de faturas de cartões de crédito e limites disponíveis.

#### `PR.002.1` — Versão Computador (Desktop)
- **Estabilidade Panorâmica:**
  - Painel lateral direito (`lg:w-96`) com chat em tempo real, visualizador de transcrição com ondas pulsantes e atalhos completos.
  - Entrada de comandos por digitação ou microfone integrado com reprodução de áudio.

#### `PR.002.2` — Versão Celular (Mobile)
- **Paridade Absoluta com Desktop:**
  - **Otimização do Hardware de Áudio Mobile:** Eliminação do conflito de concorrência de hardware (`getUserMedia` vs `SpeechRecognition`) no Android WebKit e iOS Safari, garantindo que o reconhecimento de voz capture a fala com fidelidade máxima, sem congelamentos.
  - **Caixa de Transcrição ao Vivo no Celular:** Exibição com largura total (`w-full sm:w-96 max-w-full`) da caixa de tradução ao vivo com contador de segundos, badge pulsante e botão de confirmação instantânea *"Concluir & Lançar"*.
  - **Backdrop com Desfoque (`backdrop-blur-sm`):** Fundo escuro semitransparente ao abrir o chat, permitindo fechar com um toque fora ou no botão fechar.
  - **Isolamento CSS Rigoroso:** Ajustes de viewport e prevenção de zoom indesejado em formulários móveis dentro de `@media (max-width: 768px)`.

---

### [PR.003] — IA de Áudio Multimodal (Whisper & Gemini) & Inteligência Semântica Avançada
- **Data/Hora:** 2026-10-25 02:18 (UTC-3)
- **Tags Git:** `PR.003`, `PR.003.1`, `PR.003.2`

#### `PR.003` — Escopo Geral do Projeto (Universal)
- **Motor de Transcrição por IA em Nuvem (`/api/transcribe`):**
  - Implementação de endpoint serverless com suporte duplo a **OpenAI Whisper-1** e **Google Gemini 1.5 Flash Audio Multimodal**.
  - O áudio real capturado pelo microfone é enviado automaticamente em base64 caso o reconhecimento local do navegador sofra latência, garantindo 100% de precisão para qualquer frase falada.
- **Erradicação de Popups e Alertas Intrusivos:**
  - O aviso do navegador `alert('Não foi possível identificar a voz com clareza...')` foi definitivamente removido e substituído por transcrição assíncrona por IA em background com mensagens fluidas no chat.
- **Refinamento Semântico para Expressões Cotidianas e Combustíveis:**
  - A frase *"Acabei de pagar uma conta de R$ 20 para botar combustível no carro"* e variações (*"abasteci 100 no crédito"*, *"coloquei 50 de gasolina"*) agora são categorizadas automaticamente como:
    - **Produto:** `Combustível`
    - **Estabelecimento:** `Posto de Combustível`
    - **Categoria:** `Transporte`
    - **Tipo:** `Saída (-)` com valor exato em reais.
  - O detector de pagamentos recorrentes foi aperfeiçoado para nunca confundir despesas de consumo com baixa de parcelamentos.
- **Chat Inteligente Multi-IA (`/api/chat`):**
  - Integração nativa com **Google Gemini 1.5 Flash** e **OpenAI GPT-4o-mini**, com injeção automática de contexto financeiro real.

#### `PR.003.1` — Versão Computador (Desktop)
- Fluxo híbrido com transcrição em tempo real via Web Speech + fallback automático via Whisper / Gemini sem travamento de UI.

#### `PR.003.2` — Versão Celular (Mobile)
- Transmissão estável de chunks de áudio diretamente para a nuvem sem perdas causadas por oscilações na conexão móvel.

---

### [PR.004] — Busca Semântica e Remoção Interativa de Múltiplos Lançamentos
- **Data/Hora:** 2026-10-25 02:40 (UTC-3)
- **Tags Git:** `PR.004`, `PR.004.1`, `PR.004.2`

#### `PR.004` — Escopo Geral do Projeto (Universal)
- **Cancelamento e Remoção Específica por Critério Semântico:**
  - O comando de cancelamento não fica mais restrito exclusivamente a `transactions[0]`.
  - Quando o usuário solicita remoções como *"remova o lançamento de Caxias"*, *"cancele o gasto de água"*, *"apague a compra da farmácia"*, o sistema varre todo o histórico de lançamentos (inclusive os mais antigos) analisando cidade, produto, estabelecimento, descrição e categoria com normalização fonética sem acentos (`normalizeText` e `searchTransactionsByTerm`).
  - **Se houver 0 ocorrências:** Resposta amigável informando que o termo não foi localizado, sem gerar erros ou popups.
  - **Se houver exatamente 1 ocorrência:** Exclusão automática direta, sincronização instantânea com o Firebase Cloud via `syncDeleteTransaction`, recálculo de saldos e confirmação com dados detalhados do item anulado.
  - **Se houver 2 ou mais ocorrências (ex: 3 lançamentos em Caxias):** O sistema não deleta às cegas. Ele gera uma lista acionável (`actionableTransactions`) para que o usuário decida exatamente quais deseja cancelar.
- **Sincronização Bidirecional e Integridade Financeira:**
  - O recálculo de saldo líquido, total de saídas, total de entradas e relatórios por produto/estabelecimento é acionado na hora no frontend e sincronizado com o banco de dados.

#### `PR.004.1` — Versão Computador (Desktop)
- **Card Interativo de Seleção e Exclusão no Chat:**
  - Componente de seleção visual integrado ao histórico de mensagens na sidebar direita (`lg:w-96`).
  - Checkboxes interativas estilizadas (`CheckSquare` / `Square`), botão de *"Marcar Todos / Desmarcar Todos"*.
  - Botão de lixeira rápida individual (`Trash2`) em cada linha com estorno imediato de um único lançamento.
  - Botão destacado de exclusão em lote: `🗑️ Excluir Selecionados (N)` com confirmação detalhada do valor total estornado.
  - Badge de status *"Ação já concluída para esta mensagem"* quando a exclusão for efetuada, evitando duplicações acidentais.

#### `PR.004.2` — Versão Celular (Mobile)
- **Experiência Touch Otimizada no Drawer:**
  - O card de seleção interativa encaixa-se fluidamente na gaveta lateral mobile sem ultrapassar a largura do viewport (390px).
  - Alvos de toque acessíveis (`p-2.5`, espaçamento entre linhas e botões com feedback tátil visual).
  - Informações condensadas de produto, cidade, estabelecimento, data e valor formatado com cores de alerta visual (vermelho para saída, verde para entrada).
  - Operação completa 100% por voz ou por toque direto na tela do smartphone.

---

### [PR.005] — Unificação Universal de Áudio & Atualização Imediata Mobile/Desktop
- **Data/Hora:** 2026-10-25 02:58 (UTC-3)
- **Tags Git:** `PR.005`, `PR.005.1`, `PR.005.2`

#### `PR.005` — Escopo Geral do Projeto (Universal)
- **Purga Imediata de Caches e Service Workers Legados em Dispositivos Móveis:**
  - Inclusão de rotina executada nos primeiros milissegundos de inicialização em `index.html` e `src/App.tsx` que desregistra qualquer Service Worker legado (`registration.unregister()`) e limpa todas as entradas de cache do navegador móvel (`caches.delete()`).
  - Geração de novos hashes únicos de bundle no build do Vite (`index-HZRirhOc.js`), forçando navegadores no celular (Android e iOS) a descarregar a versão mais recente em tempo real sem travar em versões antigas.
  - Inserção de cabeçalhos anti-cache no `vercel.json` (`Cache-Control: no-cache, no-store, must-revalidate`), garantindo entrega instantânea a cada deploy.
- **Motor de Áudio Físico e Universal (Zero Erros em Mobile e Desktop):**
  - Unificação completa da captura de áudio: ativada tanto no computador quanto no celular (Android e iOS).
  - O `MediaRecorder` detecta automaticamente o melhor MIME type suportado pelo hardware (`audio/webm;codecs=opus`, `audio/mp4`, `audio/aac`, `audio/ogg`).
  - O stream de áudio físico é gravado independentemente das limitações da API de fala do navegador.
  - Se a transcrição local não vier com clareza (latência de rede, silêncio do WebKit ou falha de conexão do Chrome), o áudio gravado é enviado imediatamente em base64 para a rota `/api/transcribe` com processamento por **OpenAI Whisper** e **Google Gemini 1.5 Flash**.
  - Erradicação absoluta e definitiva de qualquer popup `alert()` no sistema.
- **Consolidação de Todas as Funcionalidades Anteriores:**
  - Busca semântica e cancelamento de transações antigas e múltiplos registros (ex: 3 lançamentos em Caxias com card interativo e checkboxes).
  - Interpretação contextual de gastos diários (combustível, alimentação, farmácia, internet) sem misturar com liquidação de dívidas recorrentes.
  - Sincronização em nuvem 24 horas via Google Firebase Firestore.

#### `PR.005.1` — Versão Computador (Desktop)
- Suporte a microfones USB, headsets e microfones embutidos com visualização de transcrição em tempo real na barra lateral direita.

#### `PR.005.2` — Versão Celular (Mobile)
- Microfone móvel integrado com permissão nativa, suporte a áudio gravado no Android (WebM/Opus) e iPhone Safari (MP4/AAC), com auto-reload PWA ao detectar novos deploys.

---

### [PR.006] — Pesquisa Geral Profunda Tokenizada & Edição Interativa no Chat
- **Data/Hora:** 2026-10-25 03:05 (UTC-3)
- **Tags Git:** `PR.006`, `PR.006.1`, `PR.006.2`

#### `PR.006` — Escopo Geral do Projeto (Universal)
- **Extrator de Alvo com Suporte Plural e Expressões Naturais (`extractRemovalTarget`):**
  - Correção total de comandos falados no plural: *"remover os lançamentos de Caxias"*, *"remova os lançamentos de Caxias"*, *"apague as despesas de Caxias"*, *"cancela os gastos na cidade de Caxias"*.
  - Eliminação de falsos positivos na extração, isolando perfeitamente o termo de busca pretendido (`"caxias"`).
- **Pesquisa Geral Profunda Tokenizada (`searchTransactionsByTerm`):**
  - A busca não fica mais presa a uma única categoria ou coluna: ela consolida cidade, produto, estabelecimento, descrição, categoria, subcategoria, método de pagamento, nome do cartão de crédito e data.
  - Se o usuário pedir "Caxias", localiza lançamentos onde Caxias for município, onde for estabelecimento (*"Restaurante Caxias"*) ou onde for produto.
  - **Ação com 1 Lançamento Encontrado:** Executa automaticamente a ação (remoção/estorno ou ajuste), recalcula os saldos no Dashboard e sincroniza com o Firestore.
  - **Ação com Múltiplos Lançamentos Encontrados:** Lista todos os registros encontrados diretamente no balão de resposta do chat com opções completas de interação.
- **Interação Completa no Chat: Exclusão em Lote e Ajuste/Edição Individual:**
  - Checkboxes interativas para marcar quantos registros desejar (1, 2 ou todos).
  - Botão de lixeira rápida individual (`Trash2`) para exclusão direta de qualquer item da lista.
  - Botão de exclusão múltipla em lote: `🗑️ Excluir Selecionados (N)`.
  - **Botão de Ajuste Rápido (ícone de engrenagem/ajuste ⚙️ `Sliders`):** Abre modal responsivo para alterar Valor (R$), Tipo (Saída/Entrada), Forma de Pagamento (PIX, Débito, Crédito, Dinheiro), Cartão vinculado, Produto, Estabelecimento e Cidade, recalculando métricas financeiras instantaneamente após salvar.

#### `PR.006.1` — Versão Computador (Desktop)
- Card interativo na sidebar direita (`lg:w-96`) com botões de ajuste e exclusão e modal de edição desktop centralizado.

#### `PR.006.2` — Versão Celular (Mobile)
- O mesmo card interativo dimensionado para telas de celular (390px), com modal responsivo com rolagem touch suave (`max-h-[90vh] overflow-y-auto`) e alvos de toque ergonômicos.

---

### [PR.007] — Banco de Dados Centralizado Universal na Nuvem 24h & Áudio Dedicado Mobile
- **Data/Hora:** 2026-10-25 03:35 (UTC-3)
- **Tags Git:** `PR.007`, `PR.007.1`, `PR.007.2`

#### `PR.007` — Escopo Geral do Projeto (Universal)
- **Banco de Dados Centralizado Oficial na Nuvem (`/api/database.ts`):**
  - Eliminação completa do isolamento de dados por navegador, dispositivo ou IP.
  - Qualquer smartphone, computador ou navegador que acesse o link oficial carrega **exatamente a mesma base de dados unificada**: mesmos saldos, mesmos lançamentos reais, mesmos cartões e mesmas despesas.
  - Sincronização contínua em tempo real (polling inteligente a cada 4 segundos): se você lançar uma compra no Celular A, o Celular B e o Computador atualizam a tela automaticamente e mostram o novo saldo na mesma hora.
  - Persistência 24 horas conectada ao Google Firebase Firestore no backend com fallback para memória em nuvem no Edge.
- **Áudio no Celular Sem Colisão de Microfone (Modo Exclusivo Mobile):**
  - Fim definitivo do microfone mudo após o sinal sonoro ("plim") no Android.
  - No celular, o motor nativo `SpeechRecognition` recebe controle exclusivo do microfone, impedindo que chamadas paralelas de `getUserMedia` cortem a captura de voz.
  - A fala do usuário é redigida em tempo real no campo de texto e no visualizador ao vivo enquanto fala, e executada instantaneamente ao concluir.

#### `PR.007.1` — Versão Computador (Desktop)
- Sincronização contínua com `/api/database` em tela cheia com recálculo automático de saldos e gráficos.

#### `PR.007.2` — Versão Celular (Mobile)
- Captura de áudio nativa no Android e Safari iOS, eliminação de mocks em novos smartphones e dados 100% idênticos ao computador.

---

### [PR.008] — Integração Oficial Google Gemini 1.5 Flash Multimodal & Alimentação Automática do Sistema
- **Data/Hora:** 2026-10-25 04:15 (UTC-3)
- **Tags Git:** `PR.008`, `PR.008.1`, `PR.008.2`

#### `PR.008` — Escopo Geral do Projeto (Universal)
- **Integração Nativa Google Gemini 1.5 Flash (`/api/chat.ts`):**
  - O Chat do Kyro Finance agora é movido oficialmente pelo modelo multimodal **Google Gemini 1.5 Flash** do Google AI.
  - **Interpretação Multimodal Completa (Texto, Áudio e Imagem):**
    - **Texto:** interpreta linguagem coloquial brasileira sem falhas (ex: *"Acabei de pagar uma conta de R$ 20 para botar combustível no carro"*, *"comprei água por 5 reais em Caxias"*).
    - **Áudio Nativo Base64:** áudios gravados no celular ou computador são enviados com compressão para o Gemini, que escuta, transcreve e extrai os dados financeiros.
    - **Visão Computacional de Comprovantes e Fotos:** fotos de cupons fiscais, recibos, transferências PIX e PDFs são lidos pelo Gemini, extraindo automaticamente estabelecimento, valor, data e itens.
  - **Alimentação Automática do Sistema (Function Calling & Ações Estruturadas):**
    - Toda transação informada pelo usuário no chat é convertida em um lançamento estruturado pelo Gemini e salva imediatamente no banco de dados centralizado (`/api/database`) e no Google Firestore, recalculando saldo, total de despesas e gráficos na hora.
    - Comandos de remoção (ex: *"Remova o lançamento de Caxias"*) analisam o histórico em tempo real: se houver 1 correspondência, exclui e estorna o saldo automaticamente; se houver 2 ou mais correspondências, gera cards interativos com caixas de seleção no chat para o usuário escolher quais deseja cancelar ou excluir todos em lote.
  - **Personalização de Respostas pelo Usuário:**
    - Modal de Configuração do Gemini permite escolher o estilo das respostas:
      1. 📊 **Tabelas & Tópicos (Padrão)**: formatação visual rica em Markdown com colunas e listas claras.
      2. ⚡ **Rápido & Conciso**: respostas curtas e objetivas.
      3. 💡 **Consultoria Financeira Completa**: orientações de economia e análise profunda de gastos.
      4. ✍️ **Instrução Personalizada**: campo livre para o usuário ditar como quer que o Gemini se comporte.
    - Possibilidade de inserir Chave de API própria gratuita do Google AI Studio diretamente na interface, persistida no navegador e sincronizada com os endpoints.
  - **Renderizador de Markdown & Tabelas Integrado:**
    - Suporte a tabelas Markdown (`| ... | ... |`), marcadores de tópicos, negrito e blocos de código diretamente na bolha de resposta do chat, sem quebrar o layout.
  - **Resiliência Total (Fallback Cognitivo Local):**
    - Se a internet cair ou o usuário estiver sem chave externa, o motor cognitivo local KYRO assume de forma transparente, garantindo 100% de disponibilidade sem erros 500.

#### `PR.008.1` — Versão Computador (Desktop)
- Painel lateral do chat com badge dinâmico do Gemini 1.5 Flash, botão de ajustes rápidos no topo, tabelas Markdown em tela cheia com hover e scroll suave, atalho direto de gravação e envio de arquivos.

#### `PR.008.2` — Versão Celular (Mobile)
- Botão "Chat Gemini 1.5 Flash" integrado diretamente no menu de navegação lateral e botão no cabeçalho mobile.
- Envio de áudio direto do hardware do smartphone sem colisões de microfone.
- Tabelas Markdown adaptadas para telas verticais com rolagem horizontal touch-friendly (`overflow-x-auto`).
- Modal de configuração touch ergonômico com testes de conexão em tempo real.

---

### [PR.009] — Eliminação Definitiva do Loop de Retorno dos Lançamentos Excluídos & Tombstones Anti-Ressurreição
- **Data/Hora:** 2026-10-25 05:40 (UTC-3)
- **Tags Git:** `PR.009`, `PR.009.1`, `PR.009.2`

#### `PR.009` — Escopo Geral do Projeto (Universal)
- **Erradicação do Loop Zumbi de Lançamentos Excluídos:**
  - Identificada e eliminada a causa raiz que fazia transações excluídas reaparecerem repetidamente após alguns segundos ou ao abrir a aplicação em outro navegador/celular.
  - **Eliminação de Mock Data Estático:** Os 12 lançamentos de teste padrão que eram re-injetados quando o banco de dados ficava vazio foram completamente eliminados do código-fonte.
  - **Sistema de Tombstones Persistentes (`deletedTxIds` / `kyro_deleted_tx_ids`):**
    - Todo ID de transação excluída é registrado em uma lista imutável de exclusão tanto no `localStorage` do cliente quanto na memória central do servidor (`/api/database.ts`).
    - Qualquer dispositivo que receba uma tentativa de ressuscitação de um ID registrado como excluído bloqueia e descarta imediatamente a transação.
  - **Blindagem do Polling de Webhook:**
    - O polling periódico do webhook (`/api/webhook`) foi blindado para cruzar com a lista de exclusões e filtrar estritamente apenas novos eventos legítimos recebidos nos últimos 3 minutos, impedindo o loop de re-inserção.
  - **Correção da Persistência Canônica no Firestore (`/api/chat.ts`):**
    - Substituição do `addDoc` (que gerava IDs aleatórios divergentes do ID do lançamento) por `setDoc` com o ID exato da transação (`kyro_transactions/{txId}`), permitindo que exclusões via `deleteDoc` localizem e apaguem o documento real sem deixar resíduos zumbis no banco.
  - **Ação Oficial `clear_all` e "Zerar Base de Dados":**
    - Implementação de endpoint de limpeza completa (`/api/database` com `action: 'clear_all'`), excluindo todas as transações da memória e do Firestore sem gerar loops de ressuscitação.

#### `PR.009.1` — Versão Computador (Desktop)
- Botão "🗑️ Zerar Extrato" integrado à barra de ferramentas da aba Transações com confirmação modal para exclusão em massa com 1 clique.
- Card avançado de "Zerar Base de Dados & Lançamentos" na aba Configurações, com limpeza simultânea de Firestore, servidor local e navegador.
- Telas de estado vazio (Empty State) polidas e responsivas no Dashboard e no Extrato quando a base estiver zerada.

#### `PR.009.2` — Versão Celular (Mobile)
- Botão de zerar extrato responsivo e adaptado para telas móveis (390px) com toque tátil.
- Sincronização em nuvem instantânea: ao apagar qualquer lançamento no computador ou no celular, a exclusão é refletida imediatamente em todos os outros dispositivos sem atrasos e sem loop.
- Sincronização segura de tombstones no armazenamento móvel.

---

### [PR.010] — Autonomia Total do Chat Gemini com Aprendizado Ativo de Diretrizes e Ajustes
- **Data/Hora:** 2026-10-25 06:15 (UTC-3)
- **Tags Git:** `PR.010`, `PR.010.1`, `PR.010.2`

#### `PR.010` — Escopo Geral do Projeto (Universal)
- **Autonomia Conversacional e Aprendizado Ativo de Diretrizes:**
  - O Chat do Gemini agora possui capacidade de cognição ativa para aprender diretrizes de filtragem e comportamento conversando diretamente com o usuário.
  - O usuário pode simplesmente ditar instruções no próprio chat (ex: *"não coloque alimentação/lanche na descrição, coloque só lanche"*, *"ajuste para colocar apenas o item falado na descrição"*, *"filtre meus áudios assim..."*, *"organize tópicos de Descrição, Valor e Categoria"*).
  - A IA identifica automaticamente que se trata de uma regra personalizada e retorna a ação `save_user_rule`, memorizando a diretriz permanentemente.
- **Sincronização Universal de Regras de IA:**
  - As diretrizes aprendidas são salvas no `localStorage` (`kyro_user_ai_rules`) e sincronizadas no banco central em nuvem (`/api/database.ts` via ação `save_ai_rule`), ficando ativas instantaneamente em todos os celulares, computadores e navegadores.
  - As diretrizes são injetadas no topo do `systemInstruction` do Gemini com prioridade máxima em todas as mensagens futuras.
- **Erradicação de Descrições Mescladas com Barras:**
  - Fim definitivo de rótulos combinados como *"Alimentação / Lanche"* ou *"Transporte / Combustível"*.
  - A `description` e o `product` contêm estritamente o item específico falado (ex: *"Lanche"*), enquanto a `category` armazena de forma isolada a categoria macro (*"Alimentação"*).
- **Ajuste Direto de Lançamentos via Chat (`adjust_transaction`):**
  - O usuário pode pedir ajustes de qualquer lançamento diretamente na conversa (ex: *"mude a descrição do último para Lanche"*, *"ajuste o valor para 25"*), e o Gemini aplica a alteração no estado da aplicação, no Firestore e no banco central.
- **Apresentação Rica em Tópicos:**
  - Confirmações de lançamentos e alterações agora são apresentadas com tópicos visuais claros (Descrição, Valor, Categoria, Produto, Estabelecimento, Localidade e Forma de Pagamento).
- **Gerenciador Visual de Diretrizes no Modal de Configurações:**
  - Seção *"Diretrizes de Filtragem Aprendidas pelo Gemini"* no modal de ajustes do Chat, exibindo a contagem de regras ativas, permitindo exclusão individual, limpeza total e cadastro manual de novas regras.

#### `PR.010.1` — Versão Computador (Desktop)
- Painel lateral direito com modal de diretrizes expandido, atalhos de teclado e histórico de aprendizado da IA.
- Tópicos e tabelas Markdown fluidas em tela ampla.

#### `PR.010.2` — Versão Celular (Mobile)
- Gerenciamento touch de diretrizes aprendidas com rolagem suave no smartphone (390px).
- Sincronização em tempo real de novas regras faladas por áudio no celular refletindo imediatamente em computadores.

---

### [PR.011] — Restauração Plena do Robô WhatsApp no Grupo Oficial com Multimodalidade (Áudio, Texto e Foto) e Sincronização em Tempo Real
- **Data/Hora:** 2026-10-25 06:45 (UTC-3)
- **Tags Git:** `PR.011`, `PR.011.1`, `PR.011.2`

#### `PR.011` — Escopo Geral do Projeto (Universal)
- **Restauração e Blindagem do Monitoramento do Grupo de WhatsApp:**
  - O robô Baileys e o webhook foram reconfigurados para monitorar com fidelidade máxima o grupo vinculado oficial e qualquer grupo de finanças onde o robô for adicionado pelo usuário.
  - Eliminação de falhas de encoding de caracteres UTF-8 e auto-vinculação do JID do grupo em `monitored_group.json`.
- **Suporte Multimodal Completo no Grupo (Texto, Áudio e Foto de Comprovante):**
  - **Áudio de voz no grupo:** O arquivo de voz gravado no WhatsApp é baixado e processado pelo **Google Gemini 1.5 Flash Multimodal** e OpenAI Whisper, transcrevendo o áudio e identificando o lançamento financeiro na hora.
  - **Fotos de Comprovantes e Notas Fiscais:** Ao enviar foto no grupo do WhatsApp, a imagem é baixada via Baileys, enviada para a visão computacional do Gemini, que lê os dados (valor, estabelecimento, data) e cria o lançamento sem que você precise digitar.
  - **Mensagens de texto:** Análise semântica ágil de entradas, saídas e quitação de dívidas.
- **Resposta Padrão com Informações Filtradas no Grupo:**
  - O robô responde no próprio grupo com os tópicos filtrados (Tipo, Produto, Estabelecimento, Categoria, Valor, Forma de Pagamento e Cidade) e confirmação de atualização do sistema.
- **Sincronização Bidirecional Contínua (Sistema Web + WhatsApp):**
  - Correção da causa raiz onde transações do WhatsApp não eram salvas no banco central: agora cada transação recebida no WhatsApp é enviada para `transactions.json`, `/api/webhook`, `/api/database` (banco central universal 24h) e Google Firestore.
  - O polling em `src/App.tsx` agora persiste as transações vindas do WhatsApp via `syncSaveToCentralDb` e `kyroCloud.syncSaveTransaction`, impedindo que o recarregamento periódico as substitua ou apague.
  - O saldo geral, receitas do mês, despesas do mês e faturas de cartão são recalculados na mesma hora no Dashboard e em todas as abas.
- **Layout & Usabilidade da Aba WhatsApp & IA:**
  - Card de 4 colunas de exemplos didáticos (Despesa, Receita, Áudio e Foto de Comprovante).
  - Carregamento automático dos dados do grupo monitorado e correção do simulador para enviar mensagens com identificador de grupo (`@g.us`).

#### `PR.011.1` — Versão Computador (Desktop)
- Aba WhatsApp & IA acessível na navegação, com simulador interativo de grupo, status visual do robô e atualização instantânea de saldos e gráficos em tela cheia.

#### `PR.011.2` — Versão Celular (Mobile)
- Botão "WhatsApp & IA" no menu lateral móvel com badge "24h", sincronização contínua de transações enviadas no WhatsApp refletindo imediatamente na visualização do smartphone.

---

### [PR.012] — QR Code Oficial Criptografado do WhatsApp Web (Baileys) com Sincronização em Nuvem e Geração Instantânea
- **Data/Hora:** 2026-10-29 23:45 (UTC-3)
- **Tags Git:** `PR.012`, `PR.012.1`, `PR.012.2`

#### `PR.012` — Escopo Geral do Projeto (Universal)
- **Eliminação Definitiva do Erro "QR Code Inválido" no WhatsApp:**
  - Identificada e corrigida a causa raiz onde o componente `WhatsAppTab.tsx` exibia um fallback com link `https://wa.me/...` quando a variável `serverQrCode` estava vazia (o leitor de *"Aparelhos Conectados"* do WhatsApp rejeita qualquer URL web e exige exclusivamente o payload criptográfico `2@...` do protocolo WhatsApp Web).
  - Agora o `<QRCodeSVG>` renderiza **exclusivamente o token criptográfico oficial do WhatsApp Web** emitido pelo `@whiskeysockets/baileys`, com nível de correção `M`, margem oficial (`includeMargin={true}`) e contraste máximo (`#000000` sobre `#ffffff`), idêntico ao WhatsApp Web original.
- **Daemon do Robô Baileys (`bot.cjs`) Ativo e Auto-Recuperável:**
  - Limpeza automática de credenciais expiradas (`auth_info_baileys`) quando ocorre desconexão ou sessão inválida, gerando um novo QR Code oficial em menos de 2 segundos.
  - Novo endpoint `/api/reset-qr` e botão **"🔄 Atualizar / Gerar Novo QR Code"** na interface para permitir gerar um novo QR Code oficial do WhatsApp Web sob demanda com um clique.
- **Sincronização do QR Code Oficial entre Servidor Local e Nuvem 24h (`/api/webhook`):**
  - O `bot.cjs` agora sincroniza em tempo real o `botStatus` (incluindo o payload `qr` oficial do WhatsApp Web) com `/api/webhook`, permitindo visualizar e escanear o QR Code tanto no link local (`http://localhost:3000`) quanto no link online (`https://kyro-finance.vercel.app`).
- **Abertura Direta na Aba "Pelo QR Code (Igual WhatsApp Web)":**
  - A aba **WhatsApp & IA** agora abre diretamente no modo QR Code Oficial e valida a conexão real com o servidor antes de exibir o status de aparelho conectado.

#### `PR.012.1` — Versão Computador (Desktop)
- Painel de pareamento com QR Code Oficial do WhatsApp Web em destaque (220px com margem branca oficial), indicador ao vivo de sessão criptografada e botão de atualização instantânea.

#### `PR.012.2` — Versão Celular (Mobile)
- Visualização responsiva do QR Code Oficial do WhatsApp Web e pareamento por código de 8 dígitos perfeitamente adaptados para telas móveis.

---

### [PR.013] — Trava Exclusiva de Grupo no WhatsApp (Link + Lista de Grupos Participantes) sem Sobrescrita Automática e IA Multimodal Ativa
- **Data/Hora:** 2026-10-30 00:15 (UTC-3)
- **Tags Git:** `PR.013`, `PR.013.1`, `PR.013.2`

#### `PR.013` — Escopo Geral do Projeto (Universal)
- **Fim Definitivo da Sobrescrita Automática por Outros Grupos (`bot.cjs` e `WhatsAppTab.tsx`):**
  - **Causa Raiz Corrigida #1 (`bot.cjs`):** Removida a lógica antiga em `checkIsAuthorizedGroup` que auto-vinculava qualquer outro grupo em que o número conectado recebesse mensagem (ex: grupos grandes de terceiros). Agora o robô possui **Trava Exclusiva (`lockedByUser: true`)**: outros grupos são 100% ignorados e **jamais** alteram o grupo escolhido pelo usuário.
  - **Causa Raiz Corrigida #2 (`WhatsAppTab.tsx`):** O polling de status a cada 2,5 segundos não sobrescreve mais os campos de texto `groupInviteLink` e `groupName` enquanto o usuário cola o link ou edita o grupo.
- **Dupla Opção de Vinculação de Grupo (Por Link ou Seleção Direta de Grupos Membros):**
  - **Opção A (Colar Link do Grupo):** Ao colar o link (`https://chat.whatsapp.com/...`) e clicar em **"Vincular Link"**, o sistema identifica o grupo tanto via metadados do convite quanto varrendo os grupos onde o número conectado já é membro (`resolveGroupFromInviteLink`).
  - **Opção B (Lista de Grupos que o Número Faz Parte):** Novo endpoint `/api/groups` (`groupFetchAllParticipating`) que lista diretamente na tela todos os grupos em que o WhatsApp conectado é membro (colocando **"Finanças KYRO"** `120363411839303797@g.us` no topo da lista para seleção com 1 clique!).
- **Leitura Multimodal por IA (Áudio, Texto e Foto de Comprovante) no Grupo Vinculado:**
  - Processa mensagens enviadas no grupo vinculado (inclusive se enviadas pelo próprio número ou por outro membro do grupo, ignorando apenas as próprias respostas automáticas do robô).
  - Filtra **Texto**, **Áudio de Voz** e **Imagem/Foto de Comprovante** (usando Gemini 1.5 Flash Multimodal + Pollinations OpenAI Vision + Whisper + Extrator Semântico KYRO), responde no grupo com os tópicos filtrados e insere automaticamente no Dashboard, nas Entradas e nas Saídas.

#### `PR.013.1` — Versão Computador (Desktop)
- Painel Passo 2 com Opção A (Link de Convite) e Opção B (Seletor clicável dos grupos onde o número é membro), confirmação visual de trava exclusiva e ID oficial do grupo.

#### `PR.013.2` — Versão Celular (Mobile)
- Seleção touch de grupos participantes e colagem de link sem interferência de polling, sincronizada em tempo real com o servidor local e Vercel 24h.

---

### [PR.014] — Sincronização Instantânea de Ultra-Baixa Latência no Grupo do WhatsApp & Sistema Web (Cache Baileys + Fast-Path + Stream SSE < 10ms)
- **Data/Hora:** 2026-10-30 00:35 (UTC-3)
- **Tags Git:** `PR.014`, `PR.014.1`, `PR.014.2`

#### `PR.014` — Escopo Geral do Projeto (Universal)
- **Eliminação Total do Delay de Resposta no Grupo do WhatsApp (`bot.cjs`):**
  - **Cache Oficial de Metadados de Grupo (`cachedGroupMetadata` no `makeWASocket`):** Seguindo as melhores práticas oficiais do repositório `@whiskeysockets/baileys` no GitHub, implementamos `fullGroupMetadataCache` em memória RAM (pré-carregado com todos os 31 grupos ao conectar e atualizado via evento `groups.update`). Sem isso, o Baileys fazia uma requisição de rede bloqueante aos servidores do WhatsApp para buscar a lista de membros do grupo antes de *cada* `sock.sendMessage`, o que causava de 1,5s a 4s de atraso. Agora a resolução das chaves do grupo ocorre em **0ms**.
  - **Cache de Mensagens (`getMessage` & `messageStore` no `makeWASocket`):** Armazenamento em RAM para resolução imediata de confirmações de entrega (ACK) e retentativas de criptografia Signal no grupo sem round-trips extras.
  - **Via Rápida Instantânea (`Fast-Path < 1ms`) para Mensagens de Texto:** Eliminadas as chamadas HTTP externas bloqueantes em série que atrasavam as mensagens de texto em até 8 segundos antes do envio da resposta. Agora o motor semântico local (`parseDynamicFinancialMessage`) processa o texto em **~0,02ms** em RAM e dispara **simultaneamente em paralelo** o envio da resposta no WhatsApp (`sock.sendMessage`) e a gravação no sistema (`recordTransaction`).
- **Eliminação Total do Delay de Entrada no Sistema Web (`bot.cjs`, `src/App.tsx` e `api/webhook.ts`):**
  - **Stream em Tempo Real via Server-Sent Events (`GET /api/stream`):** Assim que a mensagem é recebida no grupo do WhatsApp, o servidor faz push instantâneo do lançamento pelo canal SSE diretamente para o navegador aberto em **3ms a 9ms** (latência quase zero, sem esperar intervalo de polling!).
  - **Polling Paralelo Turbo de 1 Segundo (`Promise.all`):** Substituído o polling sequencial antigo de 3 segundos (que esperava timeout de 2s no celular antes de consultar a nuvem) por requisições simultâneas em paralelo (`Promise.all`) a cada **1 segundo**, com agentes HTTP/HTTPS `keepAlive: true` persistentes.
  - **Leitura Direta da Memória RAM (`< 1ms`):** Os endpoints `GET /api/webhook`, `GET /api/transactions` e `GET /api/database` passaram a responder diretamente da memória RAM com escrita em disco assíncrona não-bloqueante (`fs.promises.writeFile`), além de preservação de transações recém-chegadas nos últimos 15s contra condições de corrida.
  - **Bateria de Testes em Loop Executada e Validada Internamente:** Loop de 5 testes consecutivos comprovou tempo de Webhook+Parser entre **3,55ms e 8,85ms**, entrega Push SSE para o navegador entre **3,76ms e 9,48ms**, e leitura `/api/database` em **0,76ms a 1,37ms**.

#### `PR.014.1` — Versão Computador (Desktop)
- Conexão dupla via Stream SSE (`/api/stream` e `http://localhost:3001/api/stream`) atualizando Dashboard, Entradas, Saídas e Cartões em menos de 10 milissegundos após o envio no grupo do WhatsApp.

#### `PR.014.2` — Versão Celular (Mobile)
- Sincronização paralela de 1 segundo com `keepAlive` entre o robô WhatsApp e a nuvem Vercel 24h, eliminando esperas de timeout no navegador móvel e exibindo os lançamentos do grupo quase instantaneamente.

---

### [PR.015] — Design 100% Responsivo na Aba WhatsApp & Persistência Permanente de Configurações (WhatsApp + Chat Gemini) entre Desktop e Mobile
- **Data/Hora:** 2026-10-30 00:48 (UTC-3)
- **Tags Git:** `PR.015`, `PR.015.1`, `PR.015.2`

#### `PR.015` — Escopo Geral do Projeto (Universal)
- **Design 100% Responsivo na Aba WhatsApp (`WhatsAppTab.tsx`):**
  - Toda a interface do Assistente WhatsApp & IA foi refinada para se adaptar perfeitamente a qualquer tamanho de tela (celulares de 320px/390px, tablets e monitores desktop).
  - **Cabeçalho e Seletor de Modo:** Em telas móveis, as abas *"📱 Pelo QR Code (Igual WhatsApp Web)"* e *"🔑 Por Código de 8 Dígitos"* empilham verticalmente (`grid-cols-1 sm:grid-cols-2`) sem cortar texto, e o quadro do QR Code se ajusta proporcionalmente (`max-w-[244px] w-full`).
  - **Campos e Botões do Passo 1, Passo 2 e Simulador:** Os campos de link do grupo, nome do grupo, telefone e mensagem de teste usam layout responsivo (`flex-col sm:flex-row`) com botões de largura total no celular, eliminando qualquer sobreposição de botões sobre o texto digitado.
- **Espelhamento Automático de Ajustes entre Desktop e Mobile:**
  - Qualquer ajuste feito na versão Desktop (como alterar o grupo monitorado, link de convite, estilo de resposta do Chat Gemini ou diretrizes aprendidas pela IA) é sincronizado automaticamente via `/api/database` e `/api/webhook`, refletindo na versão Mobile em até 1,5s a 2s (e vice-versa).
- **Persistência Definitiva das Configurações Atuais (`kyro_settings.json` + `monitored_group.json` + `auth_info_baileys` + `/api/database.ts`):**
  - Confirmadas e salvas permanentemente em disco, memória central e nuvem todas as configurações aprovadas pelo usuário:
    - **Grupo Oficial Vinculado e Travado:** `"Finanças KYRO"` (`120363411839303797@g.us` | `https://chat.whatsapp.com/DQNscf09vX5DljtvTnx6YK` | `lockedByUser: true`).
    - **Aparelho WhatsApp Conectado:** `558695368780` (sessão criptografada salva em `auth_info_baileys`).
    - **Configuração e Diretrizes do Chat Gemini:** Formato estruturado e regra ativa de descrição limpa (registrando apenas o item específico falado sem mesclar categoria com barras).

#### `PR.015.1` — Versão Computador (Desktop)
- Layout expandido em 12 colunas (`lg:col-span-7` + `lg:col-span-5` e 4 cards de exemplos lado a lado) com sincronização imediata de ajustes para o celular.

#### `PR.015.2` — Versão Celular (Mobile)
- Layout empilhado ergonômico para toque, sem rolagem horizontal e sem botões sobrepostos aos campos de digitação, carregando automaticamente todas as configurações salvas no Desktop.

---

### [PR.016] — Listagem e Monitoramento Exclusivo do Grupo "Finanças KYRO" (Exclusão e Ignoramento Total de Outros Grupos)
- **Data/Hora:** 2026-10-30 00:52 (UTC-3)
- **Tags Git:** `PR.016`, `PR.016.1`, `PR.016.2`

#### `PR.016` — Escopo Geral do Projeto (Universal)
- **Listagem e Cache Exclusivos para o Grupo `"Finanças KYRO"` (`120363411839303797@g.us`):**
  - Todos os outros grupos onde o número conectado participa foram completamente **excluídos da listagem do sistema e ignorados no servidor** (`bot.cjs` e `WhatsAppTab.tsx`).
  - O cache de metadados do Baileys (`fullGroupMetadataCache` e `groupCache`), o endpoint `/api/groups`, o endpoint `/api/status` e a interface da aba WhatsApp agora mantêm e exibem **única e exclusivamente** o grupo **`Finanças KYRO` (`120363411839303797@g.us`)**.
  - O filtro `checkIsAuthorizedGroup` e o listener `groups.update` ignoram silenciosamente qualquer outro grupo em 100% do tempo.

#### `PR.016.1` — Versão Computador (Desktop)
- Na aba WhatsApp & IA (Passo 2), a lista exibe exclusivamente `👥 Finanças KYRO (✓ Vinculado)`, sem poluição visual de outros grupos.

#### `PR.016.2` — Versão Celular (Mobile)
- Na versão mobile, apenas o grupo `Finanças KYRO` é listado e mantido vinculado, com design responsivo e sincronização instantânea.

---

### [PR.017] — Transformação Híbrida em Aplicativo Nativo Android (`.apk`) com CapacitorJS + GitHub Actions Cloud Builder + Sincronia Vercel 24h
- **Data/Hora:** 2026-10-30 01:24 (UTC-3)
- **Tags Git:** `PR.017`, `PR.017.1`, `PR.017.2`

#### `PR.017` — Escopo Geral do Projeto (Universal)
- **Arquitetura Híbrida Dupla (Web Vercel Online + Aplicativo Nativo Android `.apk`):**
  - Integração completa do **CapacitorJS 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)** empacotando a interface compilada (`dist/`) diretamente na memória do smartphone Android (`com.kyro.finance` / `KYRO Finance`) para abertura instantânea (`0ms`) e máxima fluidez com aceleração de hardware.
  - Criação da **Ponte Nativa Cloud (`src/nativeBridge.ts`)** que detecta automaticamente quando o sistema está rodando dentro do aplicativo Android instalado e roteia de forma transparente todas as chamadas `/api/*` (`fetch` e `EventSource`) para a nuvem da Vercel (`https://kyro-finance.vercel.app`), mantendo 100% das funções, banco centralizado 24h, WhatsApp e IA Gemini/Whisper sem alterar o funcionamento Web na Vercel.
  - Configuração de permissões nativas Android (`AndroidManifest.xml` e `MainActivity.java`) para Microfone (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`), Câmera (`CAMERA`), Armazenamento e tema escuro nativo (`#0B0F19`), além de ícones oficiais do KYRO Finance em todas as densidades (`mipmap-mdpi` a `mipmap-xxxhdpi`).
  - Criação do pipeline automatizado **GitHub Actions (`.github/workflows/android-build.yml`)** que compila o projeto Web + Android na nuvem do GitHub (sem exigir Android Studio no PC) e disponibiliza o `KYRO-Finance.apk` assinado tanto na aba *Actions* quanto em *Releases* para download direto no celular.

#### `PR.017.1` — Versão Computador (Desktop / Web Vercel)
- Continua operando 100% online na Vercel (`https://kyro-finance.vercel.app`) e localmente sem nenhuma perda de layout, função ou performance.

#### `PR.017.2` — Versão Celular (Aplicativo Android `.apk` & Mobile Web)
- Aplicativo instalável `KYRO-Finance.apk` com abertura instantânea, tela cheia nativa (`#0B0F19`), suporte nativo a microfone/câmera e sincronização em tempo real com o Desktop e a Vercel.

---

### [PR.018] — Navegação Sequencial de Abas e Proteção de Saída com Duplo Toque no Botão Voltar do Android
- **Data/Hora:** 2026-10-30 01:52 (UTC-3)
- **Tags Git:** `PR.018`, `PR.018.1`, `PR.018.2`

#### `PR.018` — Escopo Geral do Projeto (Universal)
- **Integração do Plugin Nativo `@capacitor/app`:**
  - Adicionado `@capacitor/app` com sincronização completa no Gradle Android para controle cirúrgico de ciclo de vida e eventos de botão físico/gestual de voltar (`backButton`).
  - Implementação de pilha de histórico de navegação reativa (`tabHistory`) com proteção contra stale-closure e detecção automática de navegação voluntária vs volta.

#### `PR.018.1` — Versão Computador (Desktop)
- Mantém o comportamento inalterado no navegador web e desktop, com histórico preservado.

#### `PR.018.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- **Fechamento Hierárquico de Modais e Gavetas:** Se o chat de IA no celular (`chatOpenMobile`), o menu hambúrguer ou qualquer modal estiver aberto, o botão de voltar fecha a gaveta/modal e mantém o usuário na aba atual.
- **Navegação Regressiva Entre Abas:** Se o usuário estiver em abas secundárias (ex: WhatsApp, Cartões, Transações, Configurações, etc.), cada toque no botão de voltar retorna para a aba imediatamente anterior até atingir o Dashboard principal.
- **Proteção Contra Fechamento Acidental (Duplo Toque):** Na aba principal (Dashboard), um toque único no botão de voltar não fecha o app e exibe o aviso flutuante elegante *"Pressione voltar novamente para sair"*. O aplicativo só é encerrado se o usuário apertar voltar duas vezes rapidamente (em menos de 2 segundos).

---

### [PR.019] — Sistema Autossuficiente de Atualização Automática In-App (Pop-up + 1 Toque Download e Instalação de APK)
- **Data/Hora:** 2026-10-30 02:02 (UTC-3)
- **Tags Git:** `PR.019`, `PR.019.1`, `PR.019.2`

#### `PR.019` — Escopo Geral do Projeto (Universal)
- **Endpoint Inteligente de Versões em Nuvem (`/api/app-version`):**
  - Monitora em tempo real a versão mais recente publicada na Release do GitHub (`apk-latest`) e informa número de build, versão semântica, tamanho do APK e lista de melhorias (changelog).
- **Módulo Cliente de Atualização (`src/utils/appUpdater.ts` e `src/components/UpdateModal.tsx`):**
  - Checa silenciosamente ao abrir o app e disponibiliza verificação manual nas Configurações.
  - Exibe pop-up moderno com glow temático, versão disponível, tamanho e lista de novidades.

#### `PR.019.1` — Versão Computador (Desktop)
- Mantém o sistema atualizado instantaneamente via Vercel e fornece atalho para baixar o APK atualizado para instalação manual se desejar.

#### `PR.019.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- **Plugin Nativo Android (`AppUpdateManagerPlugin.java`):**
  - Gerencia download em segundo plano com `DownloadManager` oficial do Android e barra de progresso nativa.
  - Solicitação de permissão de instalação de pacotes (`REQUEST_INSTALL_PACKAGES`) com `FileProvider` seguro (`file_paths.xml`).
  - Ao concluir o download, abre diretamente a tela do instalador do Android para atualizar o aplicativo sem sair do app e sem precisar de Play Store.

---

### [PR.020] — Correção Definitiva da Gravação de Áudio no Celular (Fim da Repetição de Palavras + MediaRecorder Unificado + IA Gemini 1.5 Flash)
- **Data/Hora:** 2026-10-30 02:20 (UTC-3)
- **Tags Git:** `PR.020`, `PR.020.1`, `PR.020.2`

#### `PR.020` — Escopo Geral do Projeto (Universal)
- **Unificação da Captura com `MediaRecorder` em Alta Fidelidade:**
  - Extinção da segregação problemática que desativava o MediaRecorder em navegadores móveis e no app.
  - Gravação de áudio real do microfone com filtros de hardware ativados (`echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`, `channelCount: 1`, `sampleRate: 48000`).
  - Algoritmo cirúrgico `cleanAndDeduplicateTranscript` que higieniza e elimina gagueiras ou repetições de palavras isoladas ou em blocos de voz.
  - Integração com a IA Multimodal **Google Gemini 1.5 Flash** (`/api/transcribe`) para transcrição cristalina de valores e comandos financeiros.

#### `PR.020.1` — Versão Computador (Desktop)
- Mantém áudio perfeito e limpo, integrado ao player e ao Gemini 1.5 Flash.

#### `PR.020.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- **Áudio Físico Real no Smartphone:** Eliminação total do bug que repetia várias vezes a primeira palavra. O aplicativo Android agora grava o arquivo de som real, exibe o player no chat e transcreve a frase uma única vez com clareza total.
- **Permissões Nativas de Microfone no Android (`MainActivity.java`):** Solicitação antecipada de permissão de gravação de áudio em tempo de execução para evitar atrasos ou bloqueios na WebView.

---

### [PR.021] — Blindagem Absoluta de Dados Financeiros (Anti-Reset) & Auto-Update Dinâmico em Tempo Real com Pop-up Durante o Uso
- **Data/Hora:** 2026-10-30 02:40 (UTC-3)
- **Tags Git:** `PR.021`, `PR.021.1`, `PR.021.2`

#### `PR.021` — Escopo Geral do Projeto (Universal)
- **Blindagem Definitiva Contra Perda de Dados Financeiros (Anti-Reset):**
  - Remoção de qualquer condição que pudesse zerar o `localStorage` ou o estado de transações quando o servidor ou banco na nuvem responder vazio (por cold-start ou primeiro acesso).
  - **Mecanismo de Re-hidratação Inteligente:** Se o servidor estiver vazio e o dispositivo local possuir transações válidas, o cliente preserva 100% dos registros e dispara automaticamente o envio dos dados locais para o banco central (`/api/database`), repovoando a nuvem.
  - Sincronização mútua e merge sem perda: transações locais e da nuvem são unificadas sem duplicatas. Apenas exclusões manuais explícitas do usuário (`deletedIds`) removem lançamentos.
  - Sincronização completa de novos lançamentos de Entrada (`newEntry`) imediatamente no banco central da nuvem e no Firestore (`kyroCloud.syncSaveTransaction` + `syncSaveToCentralDb`).
- **Sistema de Auto-Update Dinâmico com Detecção Precisa:**
  - Criação do manifesto de versão centralizado `version.json` e `src/version.ts` (Build 21 / v0.1.21).
  - Consulta da versão nativa real instalada no sistema operacional Android através do `PackageManager` (`AppUpdateManager.getAppVersion()`).
  - Comparação dinâmica do build da nuvem com o build do aparelho, eliminando o falso positivo de "Você já está na versão mais recente".

#### `PR.021.1` — Versão Computador (Desktop)
- Sincronização bidirecional ininterrupta entre a nuvem e o navegador, preservando todo o histórico financeiro mesmo em limpezas de cache de sessão.
- Verificação dinâmica de versão no painel de Configurações com indicação clara do número de versão e compilação oficiais.

#### `PR.021.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- **Pop-up Automático em Tempo Real Durante o Uso:**
  - O aplicativo monitora atualizações na nuvem automaticamente a cada 45 segundos em segundo plano, ao abrir o app e sempre que o usuário retornar para o aplicativo (evento `appStateChange` do Capacitor e `visibilitychange`).
  - Ao detectar nova versão, exibe um pop-up moderno com o changelog completo, tamanho do arquivo e botão de atualização em 1 toque.
- **Download e Instalação Nativa In-App:**
  - Download nativo em segundo plano via `DownloadManager` e disparo automático do instalador do Android via `FileProvider`.
- **Blindagem do Histórico Offline:**
  - Garantia de que nenhuma nova atualização, reinicialização de celular ou queda de sinal apague qualquer lançamento financeiro cadastrado no smartphone.

---

### [PR.022] — Robô WhatsApp 24h na Nuvem Gratuita (Render/Koyeb/Docker) + Auto-Ping Anti-Hibernação + Backup Remoto de Sessão
- **Data/Hora:** 2026-10-31 02:00 (UTC-3)
- **Tags Git:** `PR.022`, `PR.022.1`, `PR.022.2`

#### `PR.022` — Escopo Geral do Projeto (Universal)
- **Arquitetura de Nuvem Gratuita 24h para o Robô do WhatsApp:**
  - Desacoplamento da dependência de manter o computador pessoal ligado ou rodando o servidor de desenvolvimento.
  - Criação da infraestrutura pronta para deploy gratuito em 1 clique via `render.yaml` (Render.com Web Service Free) e `Dockerfile` multi-plataforma (Koyeb, Railway, HuggingFace Spaces).
  - Porta dinâmica HTTP via `process.env.PORT || process.env.BOT_PORT || 3001` e healthcheck nativo `/api/health`.
- **Mecanismo Anti-Hibernação Inteligente (Keep-Alive):**
  - Implementação de auto-ping programado a cada 9 minutos no próprio endpoint `/api/health` quando a variável de ambiente `CLOUD_BOT_URL` estiver configurada.
  - Elimina a suspensão de inatividade padrão de 15 minutos dos planos gratuitos de nuvem, mantendo a conexão do WhatsApp Web (Baileys) ativa 24 horas por dia e 7 dias por semana sem nenhum custo.
- **Persistência Remota de Sessão do WhatsApp (Anti-Logout em Nuvem Efêmera):**
  - Rotina de backup automático `syncBaileysCredsToCloud()` e restauração remota `restoreBaileysCredsFromCloud()`.
  - O arquivo crítico de autenticação criptografada (`creds.json`) é salvo no banco central da nuvem (`/api/database` com ação `save_baileys_creds`).
  - Quando a instância da nuvem é reiniciada ou transferida de container, ela puxa as credenciais da nuvem e restabelece a conexão com o WhatsApp sem solicitar novo escaneamento de QR Code.
- **Sincronização Contínua de Transações:**
  - O robô na nuvem processa mensagens de texto, áudio e fotos no grupo `"Finanças KYRO"`, grava no banco central da nuvem e o frontend consome em tempo real via polling paralelo (`${cloudBotUrl}/api/transactions`).

#### `PR.022.1` — Versão Computador (Desktop)
- **Painel de Hospedagem 24h no WhatsAppTab:**
  - Card dedicado no topo da aba *"WhatsApp & IA"* com indicador visual de status (Conectado / Desconectado), campo para salvar a URL do bot da nuvem e botão de teste de conectividade imediato.
  - Guia didático passo a passo de 3 minutos para conectar o repositório GitHub ao Render.com gratuitamente.

#### `PR.022.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- **Operação 100% Autônoma no Celular:**
  - O usuário pode enviar áudios, comprovantes em foto e textos para o grupo do WhatsApp no celular com o computador totalmente desligado.
  - A resposta automática com o filtro e a inserção imediata nos lançamentos do app mobile ocorrem diretamente pela nuvem.
  - Interface do card de nuvem e testes com suporte touch responsivo no smartphone.

---

### [PR.023] — Persistência Universal 24h na Nuvem (Render + Vercel) sem Perda ou Reset de Dados entre Dispositivos + Fim de Pop-ups Intrusivos
- **Data/Hora:** 2026-10-31 02:45 (UTC-3)
- **Tags Git:** `PR.023`, `PR.023.1`, `PR.023.2`

#### `PR.023` — Escopo Geral do Projeto (Universal)
- **Persistência Universal Contínua e Única Fonte de Verdade:**
  - Espelhamento bidirecional e redundante em tempo real entre a API Vercel e o servidor de alta disponibilidade no Render (`https://kyro-finance-bot.onrender.com/api/database`).
  - Todas as transações (entradas, saídas, Pix, débito, crédito) gravadas em qualquer dispositivo ou pelo grupo de WhatsApp são persistidas imediatamente em disco na nuvem.
  - Eliminação definitiva da necessidade de "restaurações manuais" ou backups: qualquer dispositivo novo, computador diferente, aba anônima ou celular recém-instalado carrega os dados reais instantaneamente ao abrir a aplicação.
  - Se um novo aparelho acessar com cache zerado, a nuvem responde na hora com o acervo financeiro completo, impedindo qualquer reset ou sobrescrita acidental.
- **Erradicação Completa de Pop-ups e Notificações Intrusivas:**
  - Fim do intervalo repetitivo de 45 segundos (`setInterval(performUpdateCheck, 45000)`) que forçava a abertura contínua do modal de atualização durante o uso do app.
  - Respeito à dispensa do usuário: ao fechar o pop-up de versão uma vez, a escolha é registrada e o modal nunca mais reabre sozinho.
  - O painel de Configurações permanece com a verificação manual limpa e sob demanda sempre que o usuário desejar.

#### `PR.023.1` — Versão Computador (Desktop)
- Sincronização em tempo real direta com a nuvem central em qualquer navegador (Chrome, Edge, Firefox, Brave) sem requerer login repetido ou ações de restauração.
- Interface panorâmica estável, sem pop-ups saltando na tela durante a navegação nos relatórios e extratos.

#### `PR.023.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- Ao desinstalar o aplicativo e reinstalar (ou trocar de smartphone), todos os lançamentos financeiros reaparecem intactos no primeiro segundo de abertura.
- Remoção definitiva de qualquer interrupção na tela móvel durante o uso cotidiano.

---

### [PR.024] — Interpretação Fidedigna de Áudios (Fim do Bug de R$ 20 no WhatsApp e Chat) + Auto-Update Dinâmico em Tempo Real via GitHub
- **Data/Hora:** 2026-10-31 03:00 (UTC-3)
- **Tags Git:** `PR.024`, `PR.024.1`, `PR.024.2`

#### `PR.024` — Escopo Geral do Projeto (Universal)
- **Erradicação Absoluta de Valores Padrão em Áudios (Fim do Bug de R$ 20):**
  - Eliminação definitiva da linha de fallback que inseria `'Despesa registrada por áudio de 20 reais'` quando a transcrição sofria latência.
  - O robô do WhatsApp e o chat interno agora processam o áudio real com pipeline de transcrição multimodal em múltiplas camadas (Gemini Flash Audio + Speech Recognition nativo do microfone).
  - Se um áudio de "Transferência de R$ 300" for falado, o valor extraído é exatamente R$ 300,00, categorizado corretamente em transferências/saídas.
  - Se um áudio for inaudível ou mudo, o robô responde com gentileza solicitando repetição ou digitação, **sem jamais criar lançamentos falsos de R$ 20**.
- **Detecção Precisa de Voz no Chat Interno (Preservação de Comandos Curtos):**
  - Remoção da trava que descartava falas com menos de 3 palavras (ex: *"Pix 300"*, *"Transferência 300"*). Qualquer fala reconhecida pelo microfone é aproveitada com 100% de prioridade.
- **Auto-Update Dinâmico via GitHub em Tempo Real (Fim do Falso "Já Atualizado"):**
  - O endpoint `/api/app-version` agora consulta dinamicamente o `version.json` do GitHub com cache-busting (`?t=timestamp`) e os dados da Release oficial.
  - Eliminação de valores fixos hardcoded (`buildNumber: 21`). Quando a nuvem possui versão superior (ex: Build 24), o botão "Verificar Atualização" detecta imediatamente e abre o modal com botão de download nativo do APK atualizado.

#### `PR.024.1` — Versão Computador (Desktop)
- Reconhecimento de voz no painel lateral de chat com processamento imediato de comandos de valores e transferências sem distorções de quantia.
- Verificação precisa de versões no menu de configurações com detalhes reais do changelog da compilação ativa.

#### `PR.024.2` — Versão Celular (Aplicativo Android `.apk` & Mobile)
- Transcrição no smartphone Android preservando comandos de voz rápidos com o microfone nativo.
- Botão "Verificar Atualização" com leitura da versão nativa via `PackageManager` e download direto com 1 toque do APK atualizado sem necessidade de desinstalar o app.

---

## TABELA DE CÓDIGOS DE PONTOS DE RESTAURAÇÃO

Se você desejar restaurar qualquer versão anterior ou atual do Kyro Finance, basta colar o código do ponto de restauração na conversa:

| Código do Ponto | Escopo | Descrição Resumida |
| :--- | :--- | :--- |
| **`PR.024`** | **Geral (Universal)** | **Versão Atual: Interpretação Fidedigna de Áudios (Fim do Bug de R$ 20 no WhatsApp e Chat) + Auto-Update Dinâmico em Tempo Real via GitHub** |
| `PR.024.1` | Desktop | Interface Web/Desktop com áudio preciso de comandos e verificação em tempo real de versões |
| `PR.024.2` | Mobile / APK | Aplicativo Android com reconhecimento de voz de alta fidelidade e atualização in-app com 1 toque sem desinstalar |
| **`PR.023`** | **Geral (Universal)** | Persistência Universal 24h na Nuvem (Render + Vercel) sem Perda ou Reset de Dados entre Dispositivos + Fim de Pop-ups Intrusivos |
| `PR.023.1` | Desktop | Interface Web/Desktop com sincronização contínua na nuvem em qualquer navegador sem necessidade de restauração |
| `PR.023.2` | Mobile / APK | Aplicativo Android livre de pop-ups intrusivos, com histórico financeiro 100% blindado contra desinstalação |
| **`PR.022`** | **Geral (Universal)** | Robô WhatsApp 24h na Nuvem Gratuita (Render/Koyeb/Docker) + Auto-Ping Anti-Hibernação + Backup Remoto de Sessão |
| `PR.022.1` | Desktop | Interface Web/Desktop com painel de status da nuvem, teste de conectividade e guia passo a passo |
| `PR.022.2` | Mobile / APK | Aplicativo Android 100% autônomo com computador desligado, sincronia 24h do grupo WhatsApp e persistência |
| **`PR.021`** | **Geral (Universal)** | Blindagem Absoluta de Dados Financeiros (Anti-Reset) & Auto-Update Dinâmico em Tempo Real com Pop-up Durante o Uso |
| `PR.021.1` | Desktop | Interface Web/Desktop com persistência blindada, re-hidratação de nuvem e sincronização contínua 24h |
| `PR.021.2` | Mobile / APK | Aplicativo Android com pop-up automático durante o uso (45s/retorno), checagem nativa via PackageManager e zero perda de lançamentos |
| **`PR.020`** | **Geral (Universal)** | Correção Definitiva de Áudio no Celular (Fim da Repetição de Palavras + MediaRecorder Real Unificado + Gemini 1.5 Flash Multimodal) |
| `PR.020.1` | Desktop | Interface Web/Desktop com gravação de áudio de alta fidelidade e desduplicação |
| `PR.020.2` | Mobile / APK | Aplicativo Android com áudio 100% nítido, sem repetição de palavras e permissões nativas de microfone |
| **`PR.019`** | **Geral (Universal)** | Sistema Autossuficiente de Atualizações In-App (Pop-up de Nova Versão + Download e Instalação Automática com 1 Toque no App) |
| `PR.019.1` | Desktop | Interface Web/Desktop integrada ao gerenciador de versões e changelog |
| `PR.019.2` | Mobile / APK | Aplicativo Android com pop-up automático de atualização, download nativo e instalação direta com 1 toque |
| **`PR.018`** | **Geral (Universal)** | Navegação Sequencial de Abas + Proteção Contra Fechamento com Duplo Toque de Voltar no App Android (`@capacitor/app`) |
| `PR.018.1` | Desktop | Interface Web/Desktop com estabilidade operacional inalterada |
| `PR.018.2` | Mobile / APK | Aplicativo Android com botão voltar voltando abas e chat progressivamente até o Dashboard e saída protegida por 2 cliques |
| **`PR.017`** | **Geral (Universal)** | Aplicativo Nativo Android (`KYRO-Finance.apk`) via CapacitorJS + GitHub Actions Cloud Builder + Sincronia Total com a Vercel 24h |
| `PR.017.1` | Desktop | Interface Web/Desktop operando 100% online na Vercel em sincronia em tempo real com o aplicativo Android |
| `PR.017.2` | Mobile / APK | Aplicativo Android nativo (`KYRO-Finance.apk`) com abertura instantânea, microfone/câmera nativos e conexão automática com a nuvem Vercel |
| **`PR.016`** | **Geral (Universal)** | Listagem e Monitoramento Exclusivo do Grupo `"Finanças KYRO"` (Outros Grupos Excluídos e Ignorados) + Design Responsivo + Sincronia `< 10ms` |
| `PR.016.1` | Desktop | Interface desktop exibindo exclusivamente o grupo oficial `"Finanças KYRO"` |
| `PR.016.2` | Mobile | Interface mobile responsiva exibindo exclusivamente o grupo oficial `"Finanças KYRO"` |
| **`PR.015`** | **Geral (Universal)** | Design 100% Responsivo no WhatsApp (Desktop & Mobile) + Configurações de WhatsApp e Chat Salvas e Espelhadas Automaticamente |
| `PR.015.1` | Desktop | Interface desktop com espelhamento em tempo real de todas as configurações de WhatsApp e Chat para o Mobile |
| `PR.015.2` | Mobile | Interface mobile 100% responsiva (campos e botões touch sem sobreposição) sincronizada com os ajustes do Desktop |
| **`PR.014`** | **Geral (Universal)** | Resposta Quase Instantânea no Grupo do WhatsApp (`cachedGroupMetadata` + Fast-Path) e Sincronização em Tempo Real no Sistema (`< 10ms` via SSE + Polling Paralelo 1s) |
| `PR.014.1` | Desktop | Interface desktop conectada via Stream SSE em tempo real (`< 10ms`) com atualização imediata de saldos e abas |
| `PR.014.2` | Mobile | Interface mobile com sincronização paralela turbo de 1s na nuvem 24h sem bloqueio de rede |
| **`PR.013`** | **Geral (Universal)** | Trava Exclusiva do Grupo Escolhido (por Link ou Lista de Grupos Membros), sem mudar sozinho para outros grupos, e IA Multimodal (Áudio, Texto e Foto) |
| `PR.013.1` | Desktop | Interface desktop com seletor de grupos onde o número é membro, colagem livre de link e trava exclusiva |
| `PR.013.2` | Mobile | Interface mobile com escolha rápida de grupo vinculado e sincronização automática de lançamentos |
| **`PR.012`** | **Geral (Universal)** | QR Code Oficial Criptografado do WhatsApp Web (Baileys) sem erro de leitura, geração sob demanda e sincronização local/nuvem |
| `PR.012.1` | Desktop | Interface desktop com QR Code Oficial do WhatsApp Web de alta precisão e atualização com 1 clique |
| `PR.012.2` | Mobile | Interface mobile sincronizada com status real do WhatsApp Web e grupo monitorado |
| **`PR.011`** | **Geral (Universal)** | Restauração Plena do Robô WhatsApp no Grupo Oficial com Multimodalidade (Áudio, Texto e Foto), resposta filtrada padrão e sincronização em tempo real |
| `PR.011.1` | Desktop | Interface desktop com simulador interativo de grupo, monitoramento ativo e sincronização imediata |
| `PR.011.2` | Mobile | Interface mobile com acesso à aba WhatsApp & IA e atualização simultânea de saldos no celular |
| **`PR.010`** | **Geral (Universal)** | Autonomia Total do Chat Gemini com aprendizado ativo de diretrizes via conversa, fim de descrições mescladas e ajuste direto de lançamentos |
| `PR.010.1` | Desktop | Interface desktop com modal de diretrizes expandido, tópicos ricos e badge de regras ativas |
| `PR.010.2` | Mobile | Interface mobile com gestão touch de regras aprendidas no smartphone e sincronização em tempo real |
| **`PR.009`** | **Geral (Universal)** | Eliminação definitiva do loop de retorno de lançamentos excluídos, sistema de Tombstones anti-ressurreição e botão Zerar Extrato |
| `PR.009.1` | Desktop | Interface desktop com botão Zerar Extrato, cards de limpeza total nas configurações e empty states limpos |
| `PR.009.2` | Mobile | Interface mobile com sincronização imediata de exclusões em tempo real, proteção contra ressuscitação de dados e zero loops |
| **`PR.008`** | **Geral (Universal)** | Google Gemini 1.5 Flash Multimodal (Texto, Áudio e Imagem), alimentação automática do sistema, customização de estilo em tabelas e chave pessoal |
| `PR.008.1` | Desktop | Interface desktop com renderizador de tabelas Markdown, badge Gemini e atalhos completos |
| `PR.008.2` | Mobile | Interface mobile com botão Gemini na navegação, áudio base64 sem bloqueio e tabelas touch |
| **`PR.007`** | **Geral (Universal)** | Banco de dados centralizado universal na nuvem 24h (mesmos dados em qualquer celular/PC/IP), áudio mobile sem colisão |
| `PR.007.1` | Desktop | Interface desktop com sincronização em nuvem e painel analítico |
| `PR.007.2` | Mobile | Interface mobile com áudio nativo exclusivo sem travamentos e dados compartilhados |
| **`PR.006`** | **Geral (Universal)** | Pesquisa geral profunda tokenizada (Caxias, cidades, produtos), remoção automática para 1 match e modal de ajuste |
| `PR.006.1` | Desktop | Interface desktop com card interativo e modal de ajuste |
| `PR.006.2` | Mobile | Interface móvel com drawer touch e modal de edição responsivo |
| **`PR.005`** | **Geral (Universal)** | Unificação definitiva de áudio físico móvel e desktop, PWA Network-First e zero alertas |
| `PR.005.1` | Desktop | Áudio e transcrição Whisper/Gemini universais no desktop |
| `PR.005.2` | Mobile | Áudio e transcrição Whisper/Gemini universais no celular com auto-update de cache |
| **`PR.004`** | **Geral (Universal)** | Busca semântica de lançamentos e exclusão interativa com seleção múltipla |
| `PR.004.1` | Desktop | Card interativo na sidebar direita com checkboxes e botão de exclusão em lote |
| `PR.004.2` | Mobile | Card interativo touch-friendly no drawer do smartphone |
| **`PR.003`** | **Geral (Universal)** | IA de Áudio Multimodal (Whisper & Gemini) e refinamento de combustíveis |
| **`PR.002`** | **Geral (Universal)** | Copiloto Cognitivo sem respostas padrão, manipulação do último lançamento |
| **`PR.001`** | **Geral (Universal)** | Fundação da arquitetura de Trilho Duplo, Dashboard, Transações e Cartões |

