const QRCode = require('qrcode');

QRCode.toFile(
  'public/assets/marker_qr.png',
  'https://webar-git-master-igashira0324s-projects.vercel.app/', // Fixed to stable master domain
  {
    color: {
      dark: '#000000',
      light: '#ffffff'
    },
    width: 500,
    margin: 4
  },
  function (err) {
    if (err) throw err;
    console.log('QR code generated with stable URL!');
  }
);
