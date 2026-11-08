# PROMPT MESTRE: SISTEMA DE COMPILAÇÃO AUTOMÁTICA E ATUALIZAÇÃO SILENCIOSA DE APK ANDROID (CI/CD + OTA IN-APP)

> **Instrução para a Inteligência Artificial:**  
> Você é um Engenheiro de Software Sênior especializado em Mobile (Capacitor/Android) e DevOps (GitHub Actions).  
> Sua missão é implementar o sistema completo de **Geração Automática de APK** e **Auto-Update em Tempo Real (OTA In-App)** no projeto atual, replicando exatamente o padrão industrial abaixo sem depender de lojas externas (Google Play Store).
>
> Execute a criação e configuração dos 5 componentes descritos a seguir de forma autônoma e completa.

---

## 1. VISÃO GERAL DA ARQUITETURA
1. **version.json na raiz:** Arquivo que controla a versão (`version`, `buildNumber`, `downloadUrl`, `changelog`).
2. **GitHub Actions (`.github/workflows/android-build.yml`):** Ao dar `git push`, roda o build web, sincroniza o Capacitor, compila os APKs (Debug e Release assinado com Keystore) usando Java 21 e Gradle, e publica o APK atualizado automaticamente na Release tag `apk-latest`.
3. **Plugin Nativo Java (`AppUpdateManagerPlugin.java`):** Lida com downloads em background que suportam redirecionamentos HTTP 302/307 do GitHub/AWS S3, exibe progresso e invoca o instalador oficial do Android via `FileProvider`.
4. **Módulo Frontend (`src/utils/appUpdater.ts`):** Consulta o GitHub Releases e o `version.json` via fetch sem cache (usando query param aleatório e sem headers proibidos para evitar erros de CORS), compara os códigos de versão e avisa se há update.
5. **Modal Visual (`UpdateModal.tsx`):** Exibe notificação de nova versão com barra de progresso em tempo real e botão de instalação com 1 clique.

---

## 2. ARQUIVOS E CÓDIGOS COMPLETOS PARA IMPLEMENTAÇÃO

### Componente 1: Arquivo `version.json` (Raiz do Projeto)
Crie o arquivo `version.json` na raiz do projeto:
```json
{
  "version": "1.0.0",
  "buildNumber": 1,
  "releaseDate": "2026-11-08",
  "minRequiredVersion": "1.0.0",
  "downloadUrl": "https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/download/apk-latest/app-release.apk",
  "changelog": [
    "Lançamento inicial com sistema de atualização automática",
    "Instalação direta e sincronização em nuvem"
  ]
}
```

---

### Componente 2: Pipeline CI/CD `.github/workflows/android-build.yml`
Crie a pasta `.github/workflows/` e o arquivo `android-build.yml`:
```yaml
name: Gerar Aplicativo Android (Release APK)

on:
  push:
    branches: [ "main", "master" ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-apk:
    name: Compilar APK Android
    runs-on: ubuntu-latest

    steps:
      - name: Baixar código do repositório
        uses: actions/checkout@v4

      - name: Configurar Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Instalar dependências
        run: npm install --legacy-peer-deps || npm install

      - name: Compilar Projeto Web
        run: npm run build

      - name: Sincronizar com Capacitor Android
        run: npx cap sync android

      - name: Configurar Java JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: 'gradle'

      - name: Permissão de execução no Gradle
        run: chmod +x android/gradlew

      - name: Compilar APKs com numeração dinâmica
        working-directory: ./android
        run: |
          BUILD_CODE=$(node -p "require('../version.json').buildNumber || 1")
          VERSION_NAME=$(node -p "require('../version.json').version || '1.0.0'")
          echo "BUILD_CODE=$BUILD_CODE" >> $GITHUB_ENV
          echo "VERSION_NAME=$VERSION_NAME" >> $GITHUB_ENV
          ./gradlew assembleDebug assembleRelease -PversionCode=$BUILD_CODE -PversionName="$VERSION_NAME"
          cp app/build/outputs/apk/release/app-release-unsigned.apk ../app-release.apk || cp app/build/outputs/apk/release/app-release.apk ../app-release.apk || cp app/build/outputs/apk/debug/app-debug.apk ../app-release.apk

      - name: Publicar Release Oficial no GitHub com tag apk-latest
        if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: apk-latest
          name: "📱 App Android v${{ env.VERSION_NAME }} (Build ${{ env.BUILD_CODE }})"
          body: |
            ### 🚀 Aplicativo Oficial Android
            - **Versão:** v${{ env.VERSION_NAME }} (Build ${{ env.BUILD_CODE }})
            - Baixe o APK abaixo para instalar ou atualizar diretamente no seu celular.
          files: |
            app-release.apk
          prerelease: false
          make_latest: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### Componente 3: Plugin Nativo em Java (`AppUpdateManagerPlugin.java`)
Crie no caminho `android/app/src/main/java/SEU/PACOTE/AppUpdateManagerPlugin.java` e registre-o na sua `MainActivity.java`:
```java
package com.kyro.finance; // Altere para o seu pacote se necessário

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdateManager")
public class AppUpdateManagerPlugin extends Plugin {

    private boolean isDownloading = false;

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageInfo pInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("versionName", pInfo.versionName);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ret.put("versionCode", pInfo.getLongVersionCode());
            } else {
                ret.put("versionCode", pInfo.versionCode);
            }
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("versionName", "1.0.0");
            ret.put("versionCode", 1);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ret.put("canInstall", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            ret.put("canInstall", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String downloadUrl = call.getString("url");
        if (downloadUrl == null || downloadUrl.isEmpty()) {
            call.reject("URL de download inválida");
            return;
        }

        if (isDownloading) {
            call.reject("Download já em andamento.");
            return;
        }

        isDownloading = true;

        new Thread(() -> {
            try {
                Context context = getContext();
                File downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (downloadDir == null) downloadDir = context.getCacheDir();
                File apkFile = new File(downloadDir, "app-update.apk");
                if (apkFile.exists()) apkFile.delete();

                // Seguir redirecionamentos HTTP do GitHub para AWS S3
                String currentUrl = downloadUrl;
                HttpURLConnection conn = null;
                int redirects = 0;
                while (redirects < 6) {
                    URL u = new URL(currentUrl);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.connect();
                    int status = conn.getResponseCode();
                    if (status == 301 || status == 302 || status == 307 || status == 308) {
                        currentUrl = conn.getHeaderField("Location");
                        conn.disconnect();
                        redirects++;
                    } else {
                        break;
                    }
                }

                long totalBytes = conn.getContentLengthLong();
                InputStream in = new BufferedInputStream(conn.getInputStream(), 16384);
                FileOutputStream out = new FileOutputStream(apkFile);

                byte[] buffer = new byte[8192];
                long downloadedBytes = 0;
                int readBytes;
                long lastNotify = 0;

                while ((readBytes = in.read(buffer)) != -1) {
                    downloadedBytes += readBytes;
                    out.write(buffer, 0, readBytes);
                    long now = System.currentTimeMillis();
                    if (now - lastNotify > 200 || downloadedBytes >= totalBytes) {
                        lastNotify = now;
                        int percent = (totalBytes > 0) ? (int) ((downloadedBytes * 100) / totalBytes) : -1;
                        JSObject p = new JSObject();
                        p.put("percent", percent);
                        notifyListeners("downloadProgress", p);
                    }
                }

                out.flush();
                out.close();
                in.close();
                conn.disconnect();
                isDownloading = false;

                // Executar instalação nativa
                getActivity().runOnUiThread(() -> triggerInstall(apkFile));
                call.resolve();

            } catch (Exception e) {
                isDownloading = false;
                call.reject("Erro no download: " + e.getMessage());
            }
        }).start();
    }

    private void triggerInstall(File apkFile) {
        try {
            Uri contentUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

---

### Componente 4: Verificador e Atualizador TypeScript (`src/utils/appUpdater.ts`)
Crie o arquivo `src/utils/appUpdater.ts`:
```typescript
import { App as CapApp } from '@capacitor/app';

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  latestBuild: number;
  currentVersion: string;
  currentBuild: number;
  downloadUrl: string;
  changelog: string[];
}

export async function checkForAppUpdates(repoUrl: string): Promise<UpdateInfo | null> {
  try {
    const isNative = (window as any).Capacitor?.isNativePlatform();
    if (!isNative) return null;

    // Buscar versão remota sem cache
    const response = await fetch(`${repoUrl}/raw/main/version.json?_t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (!response.ok) return null;

    const remote = await response.json();
    const appInfo = await CapApp.getInfo();
    const currentBuild = parseInt(appInfo.build, 10) || 1;

    if (remote.buildNumber > currentBuild) {
      return {
        hasUpdate: true,
        latestVersion: remote.version,
        latestBuild: remote.buildNumber,
        currentVersion: appInfo.version,
        currentBuild,
        downloadUrl: remote.downloadUrl,
        changelog: remote.changelog || []
      };
    }
    return null;
  } catch (error) {
    console.warn('Erro ao verificar atualizações do app:', error);
    return null;
  }
}

export async function downloadAndInstallUpdate(
  url: string, 
  onProgress?: (percent: number) => void
): Promise<void> {
  const cap = (window as any).Capacitor;
  const plugin = cap?.Plugins?.AppUpdateManager;

  if (!plugin) {
    window.open(url, '_system');
    return;
  }

  if (onProgress) {
    plugin.addListener('downloadProgress', (data: { percent: number }) => {
      onProgress(data.percent);
    });
  }

  await plugin.downloadAndInstall({ url });
}
```

---

### Componente 5: Interface do Usuário (Modal no `App.tsx`)
Adicione a verificação no seu componente principal:
```tsx
import React, { useEffect, useState } from 'react';
import { checkForAppUpdates, downloadAndInstallUpdate, UpdateInfo } from './utils/appUpdater';

export const App = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    // Altere para a URL do seu repositório no GitHub
    checkForAppUpdates('https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPOSITORIO').then(info => {
      if (info && info.hasUpdate) {
        setUpdateInfo(info);
      }
    });
  }, []);

  const handleUpdate = async () => {
    if (!updateInfo) return;
    await downloadAndInstallUpdate(updateInfo.downloadUrl, (p) => setProgress(p));
  };

  return (
    <div>
      {/* Resto do seu App */}

      {updateInfo && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#1e293b', color: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 9999 }}>
          <h3>🚀 Nova Atualização Disponível!</h3>
          <p>Versão {updateInfo.latestVersion} pronta para instalação.</p>
          {progress !== null ? (
            <p>Baixando: {progress}%</p>
          ) : (
            <button onClick={handleUpdate} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
              Atualizar Agora
            </button>
          )}
        </div>
      )}
    </div>
  );
};
```

---

## 3. REGRA DE OPERAÇÃO DIÁRIA (COMO ATUALIZAR)
1. Quando fizer qualquer mudança no código, aumente o `buildNumber` e `version` no arquivo `version.json`.
2. Dê `git commit` e `git push origin main`.
3. O GitHub Actions compilará o novo APK e atualizará a Release `apk-latest`.
4. Os celulares que já tiverem o aplicativo instalado receberão a notificação automaticamente e atualizarão com 1 clique!
