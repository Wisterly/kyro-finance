package com.kyro.finance;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
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
import java.util.List;

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
            ret.put("versionName", "0.1.0");
            ret.put("versionCode", 1);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            ret.put("canInstall", canInstall);
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
        String downloadUrl = call.getString("url", "https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk");

        if (isDownloading) {
            call.reject("Já existe um download de atualização em andamento.");
            return;
        }

        isDownloading = true;

        new Thread(() -> {
            File apkFile = null;
            try {
                Context context = getContext();
                File downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (downloadDir == null) {
                    downloadDir = context.getExternalCacheDir();
                }
                if (downloadDir == null) {
                    downloadDir = context.getCacheDir();
                }
                if (downloadDir != null && !downloadDir.exists()) {
                    downloadDir.mkdirs();
                }

                apkFile = new File(downloadDir, "KYRO-Finance-update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                // 1. Conexão HTTP com suporte a múltiplos redirecionamentos (GitHub 302 -> AWS S3 / Fastly)
                String currentUrl = downloadUrl;
                HttpURLConnection conn = null;
                int redirects = 0;

                while (redirects < 6) {
                    URL u = new URL(currentUrl);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android; KYRO-Finance-Updater)");
                    conn.setRequestProperty("Accept-Encoding", "identity");
                    conn.connect();

                    int status = conn.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == 307 || status == 308) {
                        String newLocation = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (newLocation == null || newLocation.isEmpty()) {
                            break;
                        }
                        currentUrl = newLocation;
                        redirects++;
                    } else {
                        break;
                    }
                }

                if (conn == null || conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    throw new Exception("Falha na conexão HTTP com o servidor (Código: " + (conn != null ? conn.getResponseCode() : "Nulo") + ")");
                }

                long totalBytes = conn.getContentLengthLong();
                InputStream in = new BufferedInputStream(conn.getInputStream(), 16384);
                FileOutputStream out = new FileOutputStream(apkFile);

                byte[] buffer = new byte[8192];
                long downloadedBytes = 0;
                int readBytes;
                long lastNotifyTime = 0;

                while ((readBytes = in.read(buffer)) != -1) {
                    downloadedBytes += readBytes;
                    out.write(buffer, 0, readBytes);

                    long now = System.currentTimeMillis();
                    if (now - lastNotifyTime > 200 || (totalBytes > 0 && downloadedBytes >= totalBytes)) {
                        lastNotifyTime = now;
                        int percent = (totalBytes > 0) ? (int) ((downloadedBytes * 100) / totalBytes) : -1;

                        JSObject progressData = new JSObject();
                        progressData.put("percent", percent);
                        progressData.put("downloaded", downloadedBytes);
                        progressData.put("total", totalBytes);
                        notifyListeners("downloadProgress", progressData);
                    }
                }

                out.flush();
                out.close();
                in.close();
                conn.disconnect();

                isDownloading = false;

                // 2. Validação de integridade do arquivo APK baixado
                if (apkFile != null && apkFile.exists() && apkFile.length() > 2 * 1024 * 1024) { // Pelo menos 2 MB
                    JSObject compData = new JSObject();
                    compData.put("status", "completed");
                    compData.put("filePath", apkFile.getAbsolutePath());
                    compData.put("fileSize", apkFile.length());
                    notifyListeners("downloadCompleted", compData);

                    final File finalApk = apkFile;
                    getActivity().runOnUiThread(() -> {
                        triggerInstall(finalApk);
                    });

                    call.resolve(compData);
                } else {
                    throw new Exception("O pacote APK baixado está incompleto ou corrompido.");
                }

            } catch (Exception e) {
                isDownloading = false;
                JSObject errData = new JSObject();
                errData.put("error", e.getMessage());
                notifyListeners("downloadError", errData);

                // Fallback automático para o navegador
                getActivity().runOnUiThread(() -> {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl));
                        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(browserIntent);
                    } catch (Exception ignored) {}
                });

                call.reject("Falha no download da atualização: " + e.getMessage(), e);
            }
        }).start();
    }

    private void triggerInstall(File apkFile) {
        try {
            Context context = getContext();
            if (apkFile == null || !apkFile.exists() || apkFile.length() == 0) return;

            // Se for Android 8+, e não tiver permissão, abre o ajuste
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + context.getPackageName()));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(settingsIntent);
                    return;
                }
            }

            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // Concede permissão de leitura explícita para os instaladores do sistema
            List<ResolveInfo> resInfoList = context.getPackageManager().queryIntentActivities(installIntent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo resolveInfo : resInfoList) {
                String packageName = resolveInfo.activityInfo.packageName;
                context.grantUriPermission(packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            context.startActivity(installIntent);

            // Encerra o aplicativo antigo de forma limpa para liberar o processo e permitir a reinstalação sem concorrência
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    if (getActivity() != null) {
                        getActivity().finishAffinity();
                    }
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(0);
                } catch (Exception ignored) {}
            }, 1200);

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @PluginMethod
    public void closeApp(PluginCall call) {
        if (call != null) {
            call.resolve();
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (getActivity() != null) {
                    getActivity().finishAffinity();
                }
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(0);
            } catch (Exception ignored) {}
        }, 300);
    }

    @PluginMethod
    public void openBrowserDownload(PluginCall call) {
        String url = call.getString("url", "https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk");
        try {
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(browserIntent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Erro ao abrir navegador: " + e.getMessage(), e);
        }
    }
}
