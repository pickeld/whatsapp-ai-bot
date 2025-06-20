/* Third-party modules */
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { useMongoDBAuthState } from 'mongo-baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';


/* Local modules */
import { messagesHandler } from './handlers/messages';
import { connectToMongoDB } from './database/mongo';
import { ENV } from './env';
import config from '../whatsapp-ai.config';


/* Util */
const connectToDatabase = async () => {
  if (ENV.MONGO_ENABLED) {
    return await useMongoDBAuthState(
      ( await connectToMongoDB() ).collection as any
    );
  } else {
    const wwjsPath = path.join(process.cwd(), config.sessionStorage.wwjsPath)
    if (!fs.existsSync(wwjsPath)) {
        fs.mkdirSync(wwjsPath, { recursive: true });
    }
    return await useMultiFileAuthState(wwjsPath);
  }
}


/* Connect to WhatsApp */
export async function connectToWhatsApp() {
  // Determine the authentication state based on the environment configuration
  const { state, saveCreds } = await connectToDatabase();

  // Create a new WhatsApp socket connection
  const sock = makeWASocket({ auth: state });

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    try {
      if (connection === 'close' && lastDisconnect) {
        const shouldReconnect =
          (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          connectToWhatsApp();
        } else {
          if (lastDisconnect.error) {
            const wwjsPath = path.join(process.cwd(), config.sessionStorage.wwjsPath)
            fs.rmSync(wwjsPath, { force: true, recursive: true });
            connectToWhatsApp();
          }
        }
      } else if (connection === 'open') {
        // Connection is open
      }
    } catch (err) {
      console.error('Error handling connection update:', err);
    }
  });

  // Handle credential updates
  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', (args) => {
    messagesHandler({ client: sock, ...args });
  });
}
