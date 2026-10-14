/**
 * KYRO Finance - Robô WhatsApp Local (Baileys)
 * Conecta diretamente ao WhatsApp do seu segundo celular sem nenhum site de terceiros!
 */
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  downloadMediaMessage 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook';
const REMOTE_WEBHOOK_URL = 'https://kyro-finance.vercel.app/api/webhook';

console.log('====================================================');
console.log('🤖 INICIANDO ROBÔ WHATSAPP LOCAL KYRO FINANCE');
console.log('📱 Transformando seu segundo celular no Robô do Sistema');
console.log('====================================================\n');

async function startBot() {
  const authFolder = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`📡 Versão do Baileys: ${version.join('.')} (Última: ${isLatest})`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['KYRO Finance Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('📲 ESCANEIE O QR CODE ABAIXO NO SEU SEGUNDO CELULAR:');
      console.log('1. Abra o WhatsApp no segundo celular (o número do Robô).');
      console.log('2. Vá em Configurações > Aparelhos Conectados > Conectar um Aparelho.');
      console.log('3. Aponte a câmera para este QR Code:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\nAguardando leitura do QR Code...\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexão encerrada (Status: ${statusCode}). Reconectando: ${shouldReconnect}...`);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        console.log('❌ Sessão desconectada. Apague a pasta "auth_info_baileys" para ler o QR Code novamente.');
      }
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('🎉 SUCESSO! SEU SEGUNDO CELULAR FOI CONECTADO AO KYRO!');
      console.log(`📱 Número Conectado: ${sock.user?.id || 'WhatsApp Ativo'}`);
      console.log('🚀 O robô já está escutando mensagens privadas e em grupos!');
      console.log('======================================================\n');
    }
  });

  // Escuta novas mensagens recebidas
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      // Ignora mensagens enviadas pelo próprio robô para evitar loops
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const sender = msg.key.participant || remoteJid;

      // Extrai texto da mensagem
      const messageText = 
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      const isAudio = !!msg.message.audioMessage;

      console.log(`\n📩 Nova Mensagem recebida [${isGroup ? 'Grupo' : 'Privado'}]:`);
      console.log(`• De: ${sender}`);
      console.log(`• Tipo: ${isAudio ? '🎙️ Áudio de Voz' : `💬 Texto: "${messageText}"`}`);

      try {
        // Envia para o Webhook do KYRO
        let webhookTarget = WEBHOOK_URL;
        let responseData = null;

        const payload = {
          event: 'messages.upsert',
          data: {
            key: msg.key,
            message: msg.message
          }
        };

        try {
          const res = await axios.post(webhookTarget, payload, { timeout: 8000 });
          responseData = res.data;
        } catch (localErr) {
          // Se o servidor local não estiver rodando na porta 3000, tenta o webhook de produção na Vercel
          try {
            const res = await axios.post(REMOTE_WEBHOOK_URL, payload, { timeout: 12000 });
            responseData = res.data;
          } catch (remoteErr) {
            console.error('Falha ao enviar webhook:', remoteErr.message);
          }
        }

        // Se o webhook processou com sucesso e retornou resposta
        if (responseData && responseData.replySent) {
          console.log(`✅ Lançamento processado! Respondendo no WhatsApp...`);
          await sock.sendMessage(remoteJid, { 
            text: responseData.replySent 
          }, { quoted: msg });
        }
      } catch (err) {
        console.error('Erro ao processar mensagem no robô:', err.message);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('Erro fatal ao iniciar bot:', err);
});
