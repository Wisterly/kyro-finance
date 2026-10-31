// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.30';
export const APP_BUILD = 30;

export const APP_CHANGELOG = [
  'Arquitetura avançada de áudio inspirada nos projetos open-source Scriberr, TranscreveZap e VoiceSummary',
  'Pré-processamento perceptual com FFmpeg e filtro de áudio EBU R128 Loudnorm (normalização de volume para áudios de voz)',
  'Pipeline multi-camada: Google Gemini 1.5 Flash Multimodal direto + Groq Whisper-large-v3 (~400ms) + OpenAI Whisper-1 + Whisper Local',
  'Extração e estruturação financeira por IA (Structured Outputs em JSON puro) sem dependência frágil de expressões regulares',
  'Suporte completo à configuração de chaves gratuitas do Google Gemini e da Groq Cloud'
];
