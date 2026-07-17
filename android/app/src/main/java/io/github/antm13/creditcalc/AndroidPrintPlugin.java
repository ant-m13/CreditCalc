package io.github.antm13.creditcalc;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidPrint")
public class AndroidPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String jobName = call.getString("jobName", "CreditCalc — кредитный график");
                PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                WebView webView = getBridge().getWebView();
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                PrintAttributes attributes = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .build();

                printManager.print(jobName, adapter, attributes);
                call.resolve();
            } catch (Exception error) {
                call.reject("Не удалось открыть системную печать", error);
            }
        });
    }
}
