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

### 2. Estrutura de Cada Ponto de Restauração (PR.00X)
- **`PR.00X.1` — Versão Computador (Desktop):** Mantém a linha de código focada na experiência de desktop ampla e estável.
- **`PR.00X.2` — Versão Celular (Mobile):** Mantém a linha de código com os ajustes, compactações e responsividade dedicados a telas móveis.

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
