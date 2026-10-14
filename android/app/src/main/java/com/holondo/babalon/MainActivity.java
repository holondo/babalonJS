package com.holondo.babalon;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

public class MainActivity extends BridgeActivity {
    private boolean isFullscreen = false;
    private ValueCallback<Uri[]> mFilePathCallback;

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
    private java.io.File arTransferFile;

    private void notifyArState(String state) {
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nativearstate', {detail:" + org.json.JSONObject.quote(state) + "}));", null);
    }

    private final ActivityResultLauncher<Intent> arActivityLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
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
                if (arTransferFile != null) { arTransferFile.delete(); arTransferFile = null; }
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
                    } catch (Exception e) {
                        if (glbFile != null && glbFile.exists()) glbFile.delete();
                        android.util.Log.e("MainActivity", "Failed to decode and launch AR", e);
                        runOnUiThread(() -> notifyArState("Could not prepare the AR scene"));
                    }
                }).start();
            }
        }, "AndroidNative");
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
