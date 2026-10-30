package com.kyro.finance;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 2002;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdateManagerPlugin.class);
        super.onCreate(savedInstanceState);

        // Configura barra de status e barra de navegação com a cor escura original do KYRO (#0B0F19)
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.parseColor("#0B0F19"));
            window.setNavigationBarColor(Color.parseColor("#0B0F19"));
        }

        // Otimizações de WebView para máxima fluidez e persistência de banco local e gravação de áudio
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            webView.setBackgroundColor(Color.parseColor("#0B0F19"));
        }

        requestAudioPermissionsIfNecessary();
    }

    private void requestAudioPermissionsIfNecessary() {
        String[] requiredPermissions = new String[] {
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        };
        List<String> toRequest = new ArrayList<>();
        for (String perm : requiredPermissions) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                toRequest.add(perm);
            }
        }
        if (!toRequest.isEmpty()) {
            ActivityCompat.requestPermissions(this, toRequest.toArray(new String[0]), AUDIO_PERMISSION_REQUEST_CODE);
        }
    }
}
