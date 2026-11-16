package app.decklan;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;


/**
 * Coquille native de DeckLan : affiche la page servie par le PC dans une WebView,
 * garde l'écran allumé (FLAG_KEEP_SCREEN_ON) et mémorise la dernière adresse.
 * Toute la logique reste sur le PC ; l'application ne contient aucun secret.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "decklan";
    private static final String KEY_URL = "url";

    private FrameLayout root;
    private WebView web;
    private LinearLayout connect;
    private EditText urlInput;
    private TextView hint;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0C10"));
        setContentView(root);

        buildWebView();
        buildConnectScreen();
        immersive();

        String fromLink = linkUrl(getIntent());
        String saved = prefs.getString(KEY_URL, "");
        if (fromLink != null) openUrl(fromLink, true);
        else if (!saved.isEmpty()) openUrl(saved, false);
        else showConnect(null);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String u = linkUrl(i);
        if (u != null) openUrl(u, true);
    }

    /** Lien d'appairage decklan://pair?u=<adresse> (QR « Ouvrir dans l'app » du PC) ou http(s) direct. */
    private String linkUrl(Intent i) {
        if (i == null) return null;
        Uri d = i.getData();
        if (d == null) return null;
        if ("decklan".equals(d.getScheme())) {
            String u = d.getQueryParameter("u");
            return (u == null || u.isEmpty()) ? null : u;
        }
        return d.toString();
    }

    private Button pill(String text, boolean primary) {
        Button bt = new Button(this);
        bt.setText(text);
        bt.setAllCaps(false);
        bt.setTextColor(Color.WHITE);
        bt.setTextSize(16);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor(Color.parseColor(primary ? "#6D4AFF" : "#232638"));
        bt.setBackground(g);
        return bt;
    }

    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B0C10"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // le jeton d'appairage vit dans localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    showConnect("PC introuvable. Vérifie qu'il est allumé, sur le même Wi-Fi, et que DeckLan tourne.");
                }
            }

            // HTTPS local : DeckLan utilise un certificat auto-signé. On l'accepte uniquement pour une adresse
            // du réseau local (IP privée, .local, localhost), jamais pour un site public.
            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) {
                String host = Uri.parse(error.getUrl()).getHost();
                if (host != null && host.matches("(localhost|.*\\.local|10\\..*|192\\.168\\..*|172\\.(1[6-9]|2\\d|3[01])\\..*)")) handler.proceed();
                else handler.cancel();
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (url != null && url.startsWith("http")) {
                    prefs.edit().putString(KEY_URL, url).apply();
                }
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void buildConnectScreen() {
        connect = new LinearLayout(this);
        connect.setOrientation(LinearLayout.VERTICAL);
        connect.setGravity(Gravity.CENTER);
        connect.setPadding(dp(28), dp(28), dp(28), dp(28));
        connect.setBackgroundColor(Color.parseColor("#0B0C10"));

        TextView title = new TextView(this);
        title.setText("DeckLan");
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setGravity(Gravity.CENTER);
        connect.addView(title);

        hint = new TextView(this);
        hint.setTextColor(Color.parseColor("#9AA0B4"));
        hint.setTextSize(15);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(10), 0, dp(22));
        connect.addView(hint);

        Button paste = pill("Coller le lien copié", false);
        paste.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pasteLink(); }
        });
        connect.addView(paste, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        urlInput = new EditText(this);
        urlInput.setHint("ou colle l'adresse : http(s)://192.168.1.20:8765/?t=…");
        urlInput.setHintTextColor(Color.parseColor("#6B7188"));
        urlInput.setTextColor(Color.WHITE);
        urlInput.setSingleLine(true);
        urlInput.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(18);
        connect.addView(urlInput, lp);

        Button go = pill("Se connecter", true);
        go.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openUrl(urlInput.getText().toString().trim(), true); }
        });
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        glp.topMargin = dp(12);
        connect.addView(go, glp);

        root.addView(connect, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        connect.setVisibility(View.GONE);
    }

    private void showConnect(String message) {
        hint.setText(message != null ? message
                : "Sur le PC : DeckLan, onglet Connexion. Scanne le QR « Ouvrir dans l'app » avec l'appareil photo, ou copie le lien et colle-le ici.");
        String saved = prefs.getString(KEY_URL, "");
        if (urlInput.getText().length() == 0 && !saved.isEmpty()) urlInput.setText(saved);
        connect.setVisibility(View.VISIBLE);
        connect.bringToFront();
    }

    private void pasteLink() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData d = cm == null ? null : cm.getPrimaryClip();
        if (d != null && d.getItemCount() > 0 && d.getItemAt(0).getText() != null) {
            String t = d.getItemAt(0).getText().toString().trim();
            Uri u = Uri.parse(t);
            if ("decklan".equals(u.getScheme()) && u.getQueryParameter("u") != null) t = u.getQueryParameter("u");
            urlInput.setText(t);
            openUrl(t, true);
        } else {
            Toast.makeText(this, "Presse-papiers vide.", Toast.LENGTH_SHORT).show();
        }
    }

    private void openUrl(String url, boolean remember) {
        if (url.isEmpty()) return;
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
        if (remember) prefs.edit().putString(KEY_URL, url).apply();
        connect.setVisibility(View.GONE);
        web.loadUrl(url);
    }

    private void immersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onBackPressed() {
        // Retour : réaffiche l'écran de connexion plutôt que de quitter par accident.
        if (connect.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
        } else {
            showConnect(null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
