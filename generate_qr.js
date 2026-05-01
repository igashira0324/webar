const QRCode = require('qrcode');

QRCode.toFile(
  'public/assets/marker_qr.png',
  'https://webar-qg96tqaxd-igashira0324s-projects.vercel.app/',
  {
    color: {
      dark: '#000000',  // Black dots
      light: '#ffffff' // White background
    },
    width: 500,
    margin: 4
  },
  function (err) {
    if (err) throw err;
    console.log('QR code generated!');
  }
);
