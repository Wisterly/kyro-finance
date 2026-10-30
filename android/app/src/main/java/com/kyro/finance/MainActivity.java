package com.kyro.finance;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configura barra de status e barra de navegação com a cor escura original do KYRO (#0B0F19)
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.parseColor("#0B0F19"));
            window.setNavigationBarColor(Color.parseColor("#0B0F19"));
        }

        // Otimizações de WebView para máxima fluidez e persistência de banco local
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
    }
}
