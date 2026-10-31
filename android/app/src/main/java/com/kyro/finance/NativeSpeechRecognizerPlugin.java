package com.kyro.finance;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "NativeSpeechRecognizer",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO },
            alias = "recordAudio"
        )
    }
)
public class NativeSpeechRecognizerPlugin extends Plugin {

    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private String lastPartialText = "";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Permissão de gravação de áudio não concedida.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    try {
                        speechRecognizer.stopListening();
                        speechRecognizer.cancel();
                        speechRecognizer.destroy();
                    } catch (Exception ignored) {}
                    speechRecognizer = null;
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                if (speechRecognizer == null) {
                    call.reject("Serviço de reconhecimento de fala não disponível no dispositivo.");
                    return;
                }

                lastPartialText = "";
                isListening = true;

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        JSObject data = new JSObject();
                        data.put("status", "ready");
                        notifyListeners("ready", data);
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        JSObject data = new JSObject();
                        data.put("status", "speaking");
                        notifyListeners("listening", data);
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {
                        JSObject data = new JSObject();
                        data.put("rms", rmsdB);
                        notifyListeners("rms", data);
                    }

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        JSObject data = new JSObject();
                        data.put("status", "end_of_speech");
                        notifyListeners("endOfSpeech", data);
                    }

                    @Override
                    public void onError(int error) {
                        isListening = false;
                        JSObject data = new JSObject();
                        data.put("error", error);
                        data.put("message", getErrorMessage(error));
                        notifyListeners("error", data);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        isListening = false;
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String finalText = (matches != null && !matches.isEmpty()) ? matches.get(0) : lastPartialText;
                        
                        JSObject data = new JSObject();
                        data.put("text", finalText);
                        notifyListeners("finalResult", data);
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            String text = matches.get(0);
                            lastPartialText = text;
                            JSObject data = new JSObject();
                            data.put("text", text);
                            notifyListeners("partialResult", data);
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
                intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, "pt-BR");
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

                speechRecognizer.startListening(intent);

                JSObject ret = new JSObject();
                ret.put("status", "listening");
                call.resolve(ret);

            } catch (Exception e) {
                isListening = false;
                call.reject("Erro ao iniciar reconhecimento nativo: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                }
                isListening = false;
                JSObject ret = new JSObject();
                ret.put("status", "stopped");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Erro ao parar: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.cancel();
                    speechRecognizer.destroy();
                    speechRecognizer = null;
                }
                isListening = false;
                JSObject ret = new JSObject();
                ret.put("status", "cancelled");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Erro ao cancelar: " + e.getMessage());
            }
        });
    }

    private String getErrorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "Erro de áudio";
            case SpeechRecognizer.ERROR_CLIENT: return "Erro no cliente";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Permissões insuficientes";
            case SpeechRecognizer.ERROR_NETWORK: return "Erro de rede";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Tempo limite de rede";
            case SpeechRecognizer.ERROR_NO_MATCH: return "Nenhum reconhecimento compatível";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Reconhecedor ocupado";
            case SpeechRecognizer.ERROR_SERVER: return "Erro no servidor de fala";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "Nenhuma fala detectada";
            default: return "Erro desconhecido (" + error + ")";
        }
    }
}
