package com.kyro.finance;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.database.Cursor;
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
import java.io.File;

@CapacitorPlugin(name = "AppUpdateManager")
public class AppUpdateManagerPlugin extends Plugin {

    private long downloadId = -1;
    private BroadcastReceiver downloadReceiver;

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
        
        try {
            Context context = getContext();
            File downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null && !downloadDir.exists()) {
                downloadDir.mkdirs();
            }
            File apkFile = new File(downloadDir, "KYRO-Finance-update.apk");
            if (apkFile.exists()) {
                apkFile.delete();
            }

            DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl));
            request.setTitle("KYRO Finance - Atualização");
            request.setDescription("Baixando nova versão do aplicativo...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationUri(Uri.fromFile(apkFile));
            request.setMimeType("application/vnd.android.package-archive");

            // Registra receiver para quando o download concluir
            if (downloadReceiver != null) {
                try {
                    context.unregisterReceiver(downloadReceiver);
                } catch (Exception ignored) {}
            }

            downloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id == downloadId) {
                        try {
                            ctx.unregisterReceiver(this);
                        } catch (Exception ignored) {}
                        downloadReceiver = null;
                        triggerInstall(apkFile);
                    }
                }
            };

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }

            downloadId = downloadManager.enqueue(request);

            JSObject res = new JSObject();
            res.put("status", "downloading");
            res.put("downloadId", downloadId);
            res.put("filePath", apkFile.getAbsolutePath());
            call.resolve(res);

        } catch (Exception e) {
            call.reject("Falha ao iniciar download da atualização: " + e.getMessage(), e);
        }
    }

    private void triggerInstall(File apkFile) {
        try {
            Context context = getContext();
            if (!apkFile.exists()) return;

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
            context.startActivity(installIntent);

        } catch (Exception e) {
            e.printStackTrace();
        }
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
