---
description: Regra obrigatória para sempre sincronizar e fornecer o link de download do arquivo APK atualizado ao final de cada ajuste no projeto KYRO Finance.
---

# Entrega Obrigatória do Link de Download do APK Atualizado (KYRO Finance)

Sempre que o usuário solicitar qualquer nova configuração, ajuste visual, correção ou melhoria no projeto **Finanças (`KYRO Finance`)**:

1. **Sincronização e Compilação Automática do APK:**
   - Execute `npm.cmd run apk:sync` (`npm run build && npx cap sync android`) antes do `git commit` e `git push origin main --tags`, garantindo que o GitHub Actions gere automaticamente o novo `KYRO-Finance.apk` atualizado na nuvem.
   - Atualize também o arquivo local `C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk` baixando a nova versão assim que a compilação concluir (ou referenciando o link direto da Release).

2. **Resumo Final Obrigatório com Link do APK:**
   - No fechamento de toda resposta de atualização, junto com as informações habituais (resumo do que foi feito, códigos de Ponto de Restauração `PR.0XX` / `PR.0XX.1` / `PR.0XX.2` e link da Vercel `https://kyro-finance.vercel.app`), **inclua obrigatoriamente o link direto para baixar o arquivo APK novo atualizado**:
     - 📱 **Baixar APK Atualizado (Download Direto):** [KYRO-Finance.apk](https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk)
     - 📦 **Página de Releases (GitHub):** [github.com/Wisterly/kyro-finance/releases](https://github.com/Wisterly/kyro-finance/releases)
     - 💻 **Arquivo Local no PC:** [`C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk`](file:///C:/Users/Lenovo/Documents/antigravity/Finan%C3%A7as/KYRO-Finance.apk)
