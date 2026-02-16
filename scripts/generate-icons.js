/**
 * Script to generate icon.png from icon.svg
 * Run with: npx electron scripts/generate-icons.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

async function generate() {
    await app.whenReady();

    // Create a silent window
    const win = new BrowserWindow({
        show: false,
        width: 256,
        height: 256,
        webPreferences: {
            offscreen: true, // Render offscreen if possible
        },
        // Frameless to ensure we just get the content (though capturePage area can be set)
    });

    // Get SVG content
    const svgPath = path.join(__dirname, '../src/renderer/assets/icon.svg');
    if (!fs.existsSync(svgPath)) {
        console.error(`SVG not found at: ${svgPath}`);
        app.quit();
        return;
    }

    const svgContent = fs.readFileSync(svgPath, 'utf-8');

    // Load content
    const html = `
    <html>
      <body style="margin: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="width: 256px; height: 256px;">
          ${svgContent}
        </div>
      </body>
    </html>
  `;

    const dataUri = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;

    await win.loadURL(dataUri);

    // Wait a moment for rendering
    await new Promise(r => setTimeout(r, 500));

    // Capture
    const image = await win.webContents.capturePage();

    const buffer = image.toPNG();
    const outputPath = path.join(__dirname, '../src/assets/icon.png');

    fs.writeFileSync(outputPath, buffer);

    console.log(`Generated icon.png at ${outputPath}`);
    app.quit();
}

generate();
