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
