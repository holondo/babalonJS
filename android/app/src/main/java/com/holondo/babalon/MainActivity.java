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
    private String pendingInboundPath = null;
    private String pendingInboundName = null;

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
            Intent chooserIntent = Intent.createChooser(baseIntent, "Choose files");

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

        // Enable WebContents debugging to inspect WebView via DevTools/CDP over ADB
        WebView.setWebContentsDebuggingEnabled(true);

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

            @JavascriptInterface
            public String getPendingFile() {
                if (pendingInboundPath == null) return null;
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("path", pendingInboundPath);
                    obj.put("name", pendingInboundName);
                    return obj.toString();
                } catch (Exception e) {
                    return null;
                }
            }

            @JavascriptInterface
            public void clearPendingFile() {
                pendingInboundPath = null;
                pendingInboundName = null;
            }
        }, "AndroidNative");

        handleInboundIntent(getIntent());
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
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_SEND.equals(action)) {
            Uri uri = null;
            if (Intent.ACTION_VIEW.equals(action)) {
                uri = intent.getData();
            } else if (Intent.ACTION_SEND.equals(action)) {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            if (uri != null) {
                processInboundUri(uri);
            }
        }
    }

    private void processInboundUri(Uri uri) {
        new Thread(() -> {
            try {
                String displayName = null;
                if ("content".equals(uri.getScheme())) {
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (nameIndex >= 0) {
                                displayName = cursor.getString(nameIndex);
                            }
                        }
                    } catch (Exception ignored) {}
                }
                if (displayName == null || displayName.trim().isEmpty()) {
                    displayName = uri.getLastPathSegment();
                }
                if (displayName == null || displayName.trim().isEmpty()) {
                    displayName = "model.glb";
                }
                if (!displayName.contains(".")) {
                    String mime = getContentResolver().getType(uri);
                    if (mime != null && (mime.contains("gltf") || mime.contains("model"))) {
                        displayName += ".glb";
                    } else if (mime != null && mime.contains("zip")) {
                        displayName += ".babalon";
                    } else {
                        displayName += ".glb";
                    }
                }

                File cacheDir = getCacheDir();
                File[] old = cacheDir.listFiles((dir, name) -> name.startsWith("inbound-"));
                if (old != null) {
                    for (File f : old) {
                        try { f.delete(); } catch (Exception ignored) {}
                    }
                }

                String ext = displayName.contains(".") ? displayName.substring(displayName.lastIndexOf('.')) : ".glb";
                File destFile = new File(cacheDir, "inbound-" + System.currentTimeMillis() + ext);
                InputStream is = null;
                if ("file".equals(uri.getScheme())) {
                    String p = uri.getPath();
                    if (p != null) {
                        try { is = new java.io.FileInputStream(new File(p)); } catch (Exception ignored) {}
                    }
                }
                if (is == null) {
                    is = getContentResolver().openInputStream(uri);
                }
                try (InputStream stream = is;
                     FileOutputStream fos = new FileOutputStream(destFile)) {
                    if (stream != null) {
                        byte[] buffer = new byte[65536];
                        int len;
                        while ((len = stream.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                        fos.flush();
                    }
                }

                if (destFile.exists() && destFile.length() > 0) {
                    final String finalPath = destFile.getAbsolutePath();
                    final String finalName = displayName;
                    runOnUiThread(() -> {
                        pendingInboundPath = finalPath;
                        pendingInboundName = finalName;
                        dispatchInboundFile(finalPath, finalName);
                    });
                }
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Error importing inbound file: " + uri, e);
            }
        }).start();
    }

    private void dispatchInboundFile(String path, String name) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            String js = "(function(){ try { if (window.onNativeFileOpen) { window.onNativeFileOpen("
                + JSONObject.quote(path) + ", " + JSONObject.quote(name) + "); } else { window.dispatchEvent(new CustomEvent('nativefileopen', { detail: { path: "
                + JSONObject.quote(path) + ", name: " + JSONObject.quote(name) + " } })); } } catch(e){} })();";
            getBridge().getWebView().evaluateJavascript(js, null);
        }
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
