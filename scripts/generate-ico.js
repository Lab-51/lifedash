const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const iconPath = path.join(__dirname, '../src/assets/icon.png');
const icoPath = path.join(__dirname, '../src/assets/icon.ico');

if (!fs.existsSync(iconPath)) {
    console.error(`PNG icon not found at ${iconPath}`);
    process.exit(1);
}

pngToIco(iconPath)
    .then(buf => {
        fs.writeFileSync(icoPath, buf);
        console.log(`Generated icon.ico at ${icoPath}`);
    })
    .catch(err => {
        console.error('Failed to generate ICO:', err);
        process.exit(1);
    });
