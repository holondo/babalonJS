package com.holondo.babalon;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private boolean isFullscreen = false;
    private ValueCallback<Uri[]> mFilePathCallback;
    /** Inbound files are copied into cache/INBOUND_DIR/&lt;batch id&gt;/, keeping their names. */
    private static final String INBOUND_DIR = "inbound";
    /** Upper bound for one inbound batch, so a broken provider can't fill the cache. */
    private static final long INBOUND_MAX_BYTES = 1024L * 1024L * 1024L;
    /** Batches the web app never acknowledged (e.g. it failed to open them) are deleted after a day. */
    private static final long INBOUND_MAX_AGE_MS = 24L * 60L * 60L * 1000L;
    private static final String INBOUND_PREFS = "inbound-state";
    private static final String INBOUND_PREF_BATCH = "batch";
    private static final String INBOUND_PREF_ID = "id";
    private volatile String pendingInboundBatch = null;
    private volatile String pendingInboundId = null;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (mFilePathCallback != null) {
                Uri[] results = null;
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[] { data.getData() };
                    } else {
                        results = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
                    }
                }
                mFilePathCallback.onReceiveValue(results);
                mFilePathCallback = null;
            }
        });

    private String pendingArGlbPath = null;
    private String pendingArTitle = null;
    private String pendingArPlacement = null;
    private java.io.File arTransferFile = null;
    private java.io.BufferedOutputStream arTransferStream = null;

    private void cleanOldArTransferFiles() {
        try {
            java.io.File cacheDir = getCacheDir();
            java.io.File[] oldFiles = cacheDir.listFiles((dir, name) -> name.startsWith("native-ar-") && name.endsWith(".glb"));
            if (oldFiles != null) {
                for (java.io.File f : oldFiles) {
                    try { f.delete(); } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
    }

    private void notifyArState(String state) {
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nativearstate', {detail:" + org.json.JSONObject.quote(state) + "}));", null);
    }

    private final ActivityResultLauncher<Intent> arActivityLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (arTransferStream != null) {
                try { arTransferStream.close(); } catch (Exception ignored) {}
                arTransferStream = null;
            }
            if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
            cleanOldArTransferFiles();
            notifyArState("closed");
        });

    private final ActivityResultLauncher<String[]> arPermissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
            Boolean cameraGranted = result.get(android.Manifest.permission.CAMERA);
            if (cameraGranted != null && cameraGranted) {
                if (pendingArGlbPath != null) {
                    Intent intent = new Intent(MainActivity.this, com.holondo.babalon.ar.ArActivity.class);
                    intent.putExtra("glb_path", pendingArGlbPath);
                    intent.putExtra("title", pendingArTitle);
                    intent.putExtra("placement", pendingArPlacement);
                    arActivityLauncher.launch(intent);
                    notifyArState("started");
                    pendingArGlbPath = null;
                    pendingArTitle = null;
                    pendingArPlacement = null;
                }
            } else {
                notifyArState("Camera permission is needed for AR");
                if (arTransferStream != null) {
                    try { arTransferStream.close(); } catch (Exception ignored) {}
                    arTransferStream = null;
                }
                if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
                cleanOldArTransferFiles();
                pendingArGlbPath = null;
                pendingArTitle = null;
                pendingArPlacement = null;
            }
        });

    private void launchArActivity(String glbPath, String title, String placement) {
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            pendingArGlbPath = glbPath;
            pendingArTitle = title;
            pendingArPlacement = placement;
            arPermissionLauncher.launch(new String[]{android.Manifest.permission.CAMERA});
            return;
        }
        Intent intent = new Intent(MainActivity.this, com.holondo.babalon.ar.ArActivity.class);
        intent.putExtra("glb_path", glbPath);
        intent.putExtra("title", title);
        intent.putExtra("placement", placement);
        arActivityLauncher.launch(intent);
        notifyArState("started");
    }

    private class CustomWebChromeClient extends BridgeWebChromeClient {
        public CustomWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams
        ) {
            if (mFilePathCallback != null) {
                mFilePathCallback.onReceiveValue(null);
            }
            mFilePathCallback = filePathCallback;

            Intent baseIntent = fileChooserParams.createIntent();
            if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                baseIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }

            // Using createChooser lets Android present all available file managers,
            // including Samsung "My Files" and system pickers.
            Intent chooserIntent = Intent.createChooser(baseIntent, getString(R.string.choose_files));

            // Specifically bundle Samsung My Files action if available on Samsung One UI
            Intent samsungIntent = new Intent("com.sec.android.app.myfiles.PICK_DATA");
            samsungIntent.putExtra("CONTENT_TYPE", "*/*");
            samsungIntent.addCategory(Intent.CATEGORY_DEFAULT);
            if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                samsungIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            if (getPackageManager().resolveActivity(samsungIntent, 0) != null) {
                chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { samsungIntent });
            }

            try {
                fileChooserLauncher.launch(chooserIntent);
                return true;
            } catch (ActivityNotFoundException e) {
                try {
                    fileChooserLauncher.launch(baseIntent);
                    return true;
                } catch (Exception ex) {
                    mFilePathCallback = null;
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure status and navigation bars have dark appearance (crisp light icons)
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        // WebView inspection over ADB in debug builds only: release pages expose AndroidNative
        WebView.setWebContentsDebuggingEnabled(BuildConfig.WEBVIEW_DEBUG);

        // Install enhanced WebChromeClient to support Samsung My Files and standard file managers
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setWebChromeClient(new CustomWebChromeClient(getBridge()));
        }

        // Add Javascript interface for native immersive fullscreen
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void toggleFullscreen() {
                runOnUiThread(() -> {
                    WindowInsetsControllerCompat insetsController =
                        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                    if (insetsController != null) {
                        isFullscreen = !isFullscreen;
                        if (isFullscreen) {
                            insetsController.hide(WindowInsetsCompat.Type.systemBars());
                            insetsController.setSystemBarsBehavior(
                                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                            );
                        } else {
                            insetsController.show(WindowInsetsCompat.Type.systemBars());
                        }
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('nativefullscreenchange', { detail: " + isFullscreen + " }));",
                            null
                        );
                    }
                });
            }

            @JavascriptInterface
            public boolean isFullscreen() {
                return isFullscreen;
            }

            @JavascriptInterface
            public void launchAr(String filePath, String title, String placement) {
                runOnUiThread(() -> launchArActivity(filePath, title, placement));
            }

            @JavascriptInterface
            public void startArTransfer(String title, String placement) {
                try {
                    if (arTransferStream != null) {
                        try { arTransferStream.close(); } catch (Exception ignored) {}
                        arTransferStream = null;
                    }
                    if (arTransferFile != null && arTransferFile.exists()) {
                        arTransferFile.delete();
                        arTransferFile = null;
                    }
                    cleanOldArTransferFiles();
                    arTransferFile = java.io.File.createTempFile("native-ar-", ".glb", getCacheDir());
                    arTransferStream = new java.io.BufferedOutputStream(new java.io.FileOutputStream(arTransferFile), 65536);
                    pendingArTitle = title;
                    pendingArPlacement = placement;
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Failed to start AR transfer", e);
                    if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
                    notifyArState("Could not prepare AR scene transfer");
                }
            }

            @JavascriptInterface
            public boolean appendArChunk(String base64Chunk) {
                try {
                    if (arTransferStream == null) return false;
                    byte[] bytes = android.util.Base64.decode(base64Chunk, android.util.Base64.DEFAULT);
                    arTransferStream.write(bytes);
                    return true;
                } catch (Throwable t) {
                    android.util.Log.e("MainActivity", "Failed to append AR chunk", t);
                    return false;
                }
            }

            @JavascriptInterface
            public void finishArTransfer() {
                new Thread(() -> {
                    try {
                        if (arTransferStream != null) {
                            arTransferStream.flush();
                            arTransferStream.close();
                            arTransferStream = null;
                        }
                        final java.io.File finalFile = arTransferFile;
                        final String title = pendingArTitle;
                        final String placement = pendingArPlacement;
                        if (finalFile != null && finalFile.exists() && finalFile.length() > 0) {
                            runOnUiThread(() -> {
                                try {
                                    launchArActivity(finalFile.getAbsolutePath(), title, placement);
                                } catch (Exception e) {
                                    if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
                                    notifyArState("Could not open native AR");
                                }
                            });
                        } else {
                            runOnUiThread(() -> notifyArState("Empty AR transfer file"));
                        }
                    } catch (Exception e) {
                        android.util.Log.e("MainActivity", "Failed to finish AR transfer", e);
                        if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
                        runOnUiThread(() -> notifyArState("Could not complete AR file transfer"));
                    }
                }).start();
            }

            @JavascriptInterface
            public void cancelArTransfer() {
                try {
                    if (arTransferStream != null) {
                        arTransferStream.close();
                        arTransferStream = null;
                    }
                    if (arTransferFile != null) {
                        arTransferFile.delete();
                        arTransferFile = null;
                    }
                } catch (Exception ignored) {}
            }

            @JavascriptInterface
            public void launchArWithData(String base64Data, String title, String placement) {
                new Thread(() -> {
                    java.io.File glbFile = null;
                    try {
                        byte[] bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                        glbFile = java.io.File.createTempFile("native-ar-", ".glb", getCacheDir());
                        try (java.io.BufferedOutputStream fos = new java.io.BufferedOutputStream(new java.io.FileOutputStream(glbFile), 65536)) {
                            fos.write(bytes);
                            fos.flush();
                        }
                        final java.io.File finalFile = glbFile;
                        runOnUiThread(() -> {
                            arTransferFile = finalFile;
                            try { launchArActivity(finalFile.getAbsolutePath(), title, placement); }
                            catch (Exception e) {
                                finalFile.delete(); arTransferFile = null;
                                notifyArState("Could not open native AR");
                            }
                        });
                    } catch (Throwable t) {
                        if (glbFile != null && glbFile.exists()) glbFile.delete();
                        android.util.Log.e("MainActivity", "Failed to decode and launch AR", t);
                        runOnUiThread(() -> notifyArState("Could not prepare the AR scene"));
                    }
                }).start();
            }

            /** The latest inbound batch not yet acknowledged, as JSON {id, files:[{path,name,type}]}, or null. */
            @JavascriptInterface
            public String getPendingFiles() {
                return pendingInboundBatch;
            }

            /** Called by the web app after it opened a batch: forgets it and deletes its cache copies. */
            @JavascriptInterface
            public void finishInbound(String id) {
                if (id == null || !id.matches("[0-9a-f-]+")) return;
                synchronized (MainActivity.this) {
                    if (id.equals(pendingInboundId)) {
                        pendingInboundBatch = null;
                        pendingInboundId = null;
                        clearPendingInbound();
                    }
                }
                new Thread(() -> deleteRecursively(new File(inboundRoot(), id))).start();
            }
        }, "AndroidNative");

        new Thread(this::expireInboundFiles).start();
        restorePendingInbound();
        // A recreated activity keeps its original intent; don't import it twice.
        if (savedInstanceState == null) handleInboundIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleInboundIntent(intent);
    }

    private void handleInboundIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        java.util.LinkedHashSet<Uri> uris = new java.util.LinkedHashSet<>();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            uris.addAll(streamExtras(intent));
            // Providers commonly expose the same shared files through both EXTRA_STREAM and
            // ClipData, sometimes using different URI spellings. Treat ClipData as a fallback
            // instead of merging both representations, otherwise multi-share imports twice.
            if (uris.isEmpty()) {
                android.content.ClipData clip = intent.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri u = clip.getItemAt(i).getUri();
                        if (u != null) uris.add(u);
                    }
                }
            }
        } else {
            return;
        }
        if (uris.isEmpty()) return;
        processInboundUris(new java.util.ArrayList<>(uris));
    }

    @SuppressWarnings("deprecation")
    private java.util.List<Uri> streamExtras(Intent intent) {
        java.util.List<Uri> out = new java.util.ArrayList<>();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                java.util.ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) for (Uri u : list) if (u != null) out.add(u);
            } else {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) out.add(u);
            }
        } catch (Exception ignored) {}
        return out;
    }

    private File inboundRoot() {
        return new File(getCacheDir(), INBOUND_DIR);
    }

    private void persistPendingInbound(String id, String json) {
        getSharedPreferences(INBOUND_PREFS, MODE_PRIVATE).edit()
            .putString(INBOUND_PREF_ID, id)
            .putString(INBOUND_PREF_BATCH, json)
            .commit();
    }

    private void clearPendingInbound() {
        // The acknowledgement must be durable before this bridge call returns: Android may
        // recreate the Activity immediately afterwards and must not restore the same batch.
        getSharedPreferences(INBOUND_PREFS, MODE_PRIVATE).edit().clear().commit();
    }

    private void restorePendingInbound() {
        android.content.SharedPreferences prefs = getSharedPreferences(INBOUND_PREFS, MODE_PRIVATE);
        String id = prefs.getString(INBOUND_PREF_ID, null);
        String json = prefs.getString(INBOUND_PREF_BATCH, null);
        File batchDir = id == null ? null : new File(inboundRoot(), id);
        if (id == null || json == null || batchDir == null || !batchDir.isDirectory()
            || System.currentTimeMillis() - batchDir.lastModified() > INBOUND_MAX_AGE_MS) {
            clearPendingInbound();
            return;
        }
        pendingInboundId = id;
        pendingInboundBatch = json;
    }

    /** Deletes inbound batches older than {@link #INBOUND_MAX_AGE_MS} and copies left by older builds. */
    private void expireInboundFiles() {
        long now = System.currentTimeMillis();
        File[] legacy = getCacheDir().listFiles((dir, name) -> name.startsWith("inbound-"));
        if (legacy != null) for (File f : legacy) deleteRecursively(f);
        File[] batches = inboundRoot().listFiles();
        if (batches == null) return;
        for (File b : batches) {
            if (now - b.lastModified() > INBOUND_MAX_AGE_MS) deleteRecursively(b);
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        try { f.delete(); } catch (Exception ignored) {}
    }

    /** A file name safe to create inside the batch folder, keeping the original name where possible. */
    private static String safeName(String name, java.util.Set<String> used) {
        String base = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) base = "file";
        String candidate = base;
        int dot = base.lastIndexOf('.');
        String stem = dot > 0 ? base.substring(0, dot) : base, ext = dot > 0 ? base.substring(dot) : "";
        for (int i = 2; used.contains(candidate.toLowerCase(java.util.Locale.ROOT)); i++) candidate = stem + " (" + i + ")" + ext;
        used.add(candidate.toLowerCase(java.util.Locale.ROOT));
        return candidate;
    }

    private String displayNameOf(Uri uri) {
        String displayName = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) displayName = cursor.getString(nameIndex);
                }
            } catch (Exception ignored) {}
        }
        if (displayName == null || displayName.trim().isEmpty()) displayName = uri.getLastPathSegment();
        if (displayName == null || displayName.trim().isEmpty()) displayName = "model";
        int slash = displayName.lastIndexOf('/');
        if (slash >= 0) displayName = displayName.substring(slash + 1);
        if (!displayName.contains(".")) {
            String mime = getContentResolver().getType(uri);
            displayName += mime != null && mime.contains("zip") ? ".babalon" : ".glb";
        }
        return displayName;
    }

    private InputStream openUri(Uri uri) throws java.io.IOException {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            try { return new java.io.FileInputStream(new File(uri.getPath())); } catch (Exception ignored) {}
        }
        InputStream is = getContentResolver().openInputStream(uri);
        if (is == null) throw new java.io.IOException("No stream for " + uri);
        return is;
    }

    private void processInboundUris(java.util.List<Uri> uris) {
        new Thread(() -> {
            expireInboundFiles();
            String id = Long.toString(System.currentTimeMillis()) + "-" + Integer.toHexString((int) (Math.random() * 0xffff));
            File batchDir = new File(inboundRoot(), id);
            try {
                if (!batchDir.mkdirs()) throw new java.io.IOException("Could not create " + batchDir);
                org.json.JSONArray files = new org.json.JSONArray();
                java.util.Set<String> used = new java.util.HashSet<>();
                long total = 0;
                byte[] buffer = new byte[65536];
                for (Uri uri : uris) {
                    String name = displayNameOf(uri);
                    File dest = new File(batchDir, safeName(name, used));
                    try (InputStream stream = openUri(uri); FileOutputStream fos = new FileOutputStream(dest)) {
                        int len;
                        while ((len = stream.read(buffer)) > 0) {
                            total += len;
                            if (total > INBOUND_MAX_BYTES) throw new InboundTooLarge();
                            fos.write(buffer, 0, len);
                        }
                    }
                    if (dest.length() == 0) { dest.delete(); continue; }
                    JSONObject f = new JSONObject();
                    f.put("path", dest.getAbsolutePath());
                    f.put("name", dest.getName());
                    String mime = getContentResolver().getType(uri);
                    f.put("type", mime != null ? mime : "");
                    files.put(f);
                }
                if (files.length() == 0) throw new java.io.IOException("Empty inbound batch");
                JSONObject batch = new JSONObject();
                batch.put("id", id);
                batch.put("files", files);
                final String json = batch.toString();
                persistPendingInbound(id, json);
                runOnUiThread(() -> {
                    pendingInboundBatch = json;
                    pendingInboundId = id;
                    dispatchInbound(json);
                });
            } catch (InboundTooLarge e) {
                deleteRecursively(batchDir);
                runOnUiThread(() -> dispatchInboundError("The shared files are too large to open (limit 1 GB)."));
            } catch (Exception e) {
                deleteRecursively(batchDir);
                android.util.Log.e("MainActivity", "Error importing inbound files", e);
                runOnUiThread(() -> dispatchInboundError("Could not read the shared files. Try sharing them again."));
            }
        }).start();
    }

    private static final class InboundTooLarge extends Exception {}

    private void dispatchInbound(String batchJson) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nativefilesopen', { detail: " + batchJson + " }));", null);
    }

    private void dispatchInboundError(String message) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nativefileserror', { detail: " + JSONObject.quote(message) + " }));", null);
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (getBridge() != null && getBridge().getWebView() != null) {
            if (level >= TRIM_MEMORY_UI_HIDDEN) {
                getBridge().getWebView().freeMemory();
            }
        }
    }
}
