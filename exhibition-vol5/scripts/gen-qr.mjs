import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

// URL to be encoded (Likely Vercel URL based on repo name)
const url = 'https://webar-coral.vercel.app/exhibition-vol5/'; 

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../qr-archive.png');

async function generateQR() {
  try {
    await QRCode.toFile(outputPath, url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 1024,
      color: {
        dark: '#0a0a1a',  // QR Code color (Deep Blue)
        light: '#ffffff'   // Background color
      }
    });
    console.log(`✅ ${outputPath} generated`);
  } catch (err) {
    console.error('Error generating QR code:', err);
  }
}

generateQR();
