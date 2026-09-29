const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pngToIco = require('png-to-ico').default;
const sharp = require('sharp');

const projectRoot = path.join(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-icon-'));
const squarePngPath = path.join(temporaryDirectory, 'flashlogo.png');

async function createIcon() {
    try {
        await sharp(path.join(projectRoot, 'flashlogo.png'))
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(squarePngPath);
        const icon = await pngToIco(squarePngPath);
        fs.writeFileSync(path.join(projectRoot, 'flashlogo.ico'), icon);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

createIcon().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });