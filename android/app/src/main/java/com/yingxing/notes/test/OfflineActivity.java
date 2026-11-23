package com.yingxing.notes.test;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public class OfflineActivity extends Activity {
    private static final int FILE_REQUEST = 24;
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView webView;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private final DownloadBridge downloadBridge = new DownloadBridge();
    private final ExecutorService modelWorker = Executors.newFixedThreadPool(2);

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(244, 247, 247));
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(webView);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.addJavascriptInterface(downloadBridge, "YingxingAndroidDownload");
        webView.addJavascriptInterface(new ModelBridge(), "YuanModelBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost()) || !"https".equals(uri.getScheme()))
                    return response(403, "Forbidden", "text/plain", new byte[0]);
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/offline.html";
                if (path.contains("..") || path.contains("\\"))
                    return response(404, "Not Found", "text/plain", new byte[0]);
                try {
                    return new WebResourceResponse(mime(path), "UTF-8", getAssets().open("web" + path));
                } catch (IOException error) {
                    return response(404, "Not Found", "text/plain", new byte[0]);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !ORIGIN.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(intent, FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    Toast.makeText(OfflineActivity.this, "未找到文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        webView.loadUrl(ORIGIN + "/offline.html");
    }

    private WebResourceResponse response(int code, String reason, String mime, byte[] bytes) {
        WebResourceResponse result = new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(bytes));
        result.setStatusCodeAndReasonPhrase(code, reason);
        return result;
    }

    private String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    public class ModelBridge {
        @JavascriptInterface
        public boolean isOnline() {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (manager == null || manager.getActiveNetwork() == null) return false;
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
            return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        }

        @JavascriptInterface
        public void request(String id, String endpoint, String payload, String key) {
            modelWorker.execute(() -> {
                int status = 0;
                byte[] bytes;
                HttpsURLConnection connection = null;
                try {
                    if (!isOnline()) throw new IOException("设备未联网");
                    URI uri = new URI(endpoint);
                    URL url = uri.toURL();
                    if (!"https".equals(url.getProtocol()) || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null ||
                        url.getHost().isEmpty() || endpoint.length() > 2048 || payload.length() > 8_000_000 || key.length() > 4096)
                        throw new IOException("模型接口地址无效");
                    String host = url.getHost().toLowerCase(Locale.ROOT);
                    if (host.equals("localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost"))
                        throw new IOException("模型接口必须是公网地址");
                    for (InetAddress address : InetAddress.getAllByName(host)) {
                        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() ||
                            address.isSiteLocalAddress() || address.isMulticastAddress()) throw new IOException("模型接口必须是公网地址");
                    }
                    connection = (HttpsURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(120000);
                    connection.setRequestMethod("POST");
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.setRequestProperty("Authorization", "Bearer " + key);
                    connection.setDoOutput(true);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(payload.getBytes(StandardCharsets.UTF_8));
                    }
                    status = connection.getResponseCode();
                    InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    bytes = input == null ? new byte[0] : readLimited(input);
                } catch (Exception error) {
                    status = 0;
                    bytes = "{}".getBytes(StandardCharsets.UTF_8);
                } finally {
                    if (connection != null) connection.disconnect();
                }
                String encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                int resultStatus = status;
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript("window.__yuanModelResponse(" + JSONObject.quote(id) + "," + resultStatus + "," + JSONObject.quote(encoded) + ")", null);
                });
            });
        }

        private byte[] readLimited(InputStream input) throws IOException {
            try (InputStream source = input; ByteArrayOutputStream result = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int size;
                while ((size = source.read(buffer)) != -1) {
                    if (result.size() + size > 2_000_000) throw new IOException("模型响应过大");
                    result.write(buffer, 0, size);
                }
                return result.toByteArray();
            }
        }
    }

    public class DownloadBridge {
        private OutputStream stream;
        private Uri item;
        private File file;

        @JavascriptInterface
        public synchronized void begin(String filename, String mime) {
            cancel();
            String safe = filename == null ? "" : filename.replaceAll("[/\\\\\\p{Cntrl}]", "_").trim();
            if (safe.isEmpty()) safe = "源笔记备份.zip";
            if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (item == null) throw new IOException("无法创建下载文件");
                    stream = getContentResolver().openOutputStream(item);
                } else {
                    File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (directory == null) throw new IOException("无法访问下载目录");
                    file = new File(directory, safe);
                    for (int suffix = 1; file.exists(); suffix++) file = new File(directory, suffix + "-" + safe);
                    stream = new FileOutputStream(file);
                }
                if (stream == null) throw new IOException("无法写入下载文件");
            } catch (IOException error) {
                cancel();
                throw new IllegalStateException("无法保存到手机下载目录", error);
            }
        }

        @JavascriptInterface
        public synchronized void chunk(String base64) {
            if (stream == null) throw new IllegalStateException("下载尚未开始");
            try {
                stream.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT));
            } catch (IOException error) {
                cancel();
                throw new IllegalStateException("写入文件失败", error);
            }
        }

        @JavascriptInterface
        public synchronized void finish() {
            if (stream == null) throw new IllegalStateException("下载尚未开始");
            try {
                stream.close();
                stream = null;
                if (item != null) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(item, values, null, null);
                }
                item = null;
                file = null;
                runOnUiThread(() -> Toast.makeText(OfflineActivity.this, "已保存到手机下载目录", Toast.LENGTH_LONG).show());
            } catch (IOException error) {
                cancel();
                throw new IllegalStateException("保存文件失败", error);
            }
        }

        @JavascriptInterface
        public synchronized void cancel() {
            if (stream != null) try { stream.close(); } catch (IOException ignored) { }
            stream = null;
            if (item != null) getContentResolver().delete(item, null, null);
            if (file != null && file.exists()) file.delete();
            item = null;
            file = null;
        }

        @JavascriptInterface
        public synchronized void save(String filename, String mime, String base64) {
            if (base64 == null || base64.length() > 32_000_000) throw new IllegalArgumentException("导出文件过大");
            begin(filename, mime);
            try { chunk(base64); finish(); }
            catch (RuntimeException error) { cancel(); throw error; }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            android.webkit.ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            Uri[] files = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData selected = data.getClipData();
                if (selected != null && selected.getItemCount() > 0) {
                    files = new Uri[selected.getItemCount()];
                    for (int index = 0; index < selected.getItemCount(); index++) {
                        files[index] = selected.getItemAt(index).getUri();
                    }
                } else if (data.getData() != null) {
                    files = new Uri[] { data.getData() };
                }
            }
            callback.onReceiveValue(files);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        downloadBridge.cancel();
        modelWorker.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
