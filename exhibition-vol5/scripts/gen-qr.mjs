import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

// URL to be encoded (User should replace this with their Vercel URL)
const url = 'https://exhibition-vol5-archive.vercel.app/'; 

const outputPath = path.join(process.cwd(), 'qr-archive.png');

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
