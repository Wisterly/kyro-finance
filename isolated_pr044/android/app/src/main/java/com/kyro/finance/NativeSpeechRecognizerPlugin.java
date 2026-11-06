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
import com.getcapacitor.annotation.PermissionCallback;
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
    private String accumulatedText = "";

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
            requestPermissionForAlias("recordAudio", call, "checkPermissionsCallback");
            return;
        }
        executeStartListening(call);
    }

    @PermissionCallback
    private void checkPermissionsCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            executeStartListening(call);
        } else {
            call.reject("Permissão de microfone negada pelo usuário.");
        }
    }

    private Intent createSpeechIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L);
        return intent;
    }

    private void executeStartListening(PluginCall call) {
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
                accumulatedText = "";
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
                        // Se o erro for pausa na fala ou sem correspondência temporária, continua ouvindo se o usuário ainda estiver gravando
                        if (isListening && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                            if (speechRecognizer != null) {
                                try {
                                    speechRecognizer.startListening(createSpeechIntent());
                                    return;
                                } catch (Exception ignored) {}
                            }
                        }

                        isListening = false;
                        JSObject data = new JSObject();
                        data.put("error", error);
                        data.put("message", getErrorMessage(error));
                        notifyListeners("error", data);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String currentSentence = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                        if (!currentSentence.isEmpty()) {
                            if (accumulatedText.isEmpty()) {
                                accumulatedText = currentSentence;
                            } else {
                                accumulatedText += " " + currentSentence;
                            }
                            lastPartialText = accumulatedText;
                            JSObject data = new JSObject();
                            data.put("text", accumulatedText);
                            notifyListeners("partialResult", data);
                        }

                        // Escuta contínua: se o usuário ainda não apertou em Lançar, continua ouvindo
                        if (isListening && speechRecognizer != null) {
                            try {
                                speechRecognizer.startListening(createSpeechIntent());
                            } catch (Exception ignored) {}
                        }
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            String partial = matches.get(0);
                            String full = accumulatedText.isEmpty() ? partial : (accumulatedText + " " + partial);
                            lastPartialText = full;
                            JSObject data = new JSObject();
                            data.put("text", full);
                            notifyListeners("partialResult", data);
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                speechRecognizer.startListening(createSpeechIntent());

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
            isListening = false;
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                }

                String finalText = accumulatedText.trim();
                if (finalText.isEmpty()) {
                    finalText = lastPartialText.trim();
                }

                JSObject data = new JSObject();
                data.put("text", finalText);
                notifyListeners("finalResult", data);

                JSObject ret = new JSObject();
                ret.put("status", "stopped");
                ret.put("text", finalText);
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
                isListening = false;
                accumulatedText = "";
                lastPartialText = "";
                if (speechRecognizer != null) {
                    speechRecognizer.cancel();
                    speechRecognizer.destroy();
                    speechRecognizer = null;
                }
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
