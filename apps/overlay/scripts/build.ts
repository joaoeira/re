import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const contents = resolve(import.meta.dir, "../dist/re Overlay.app/Contents");
mkdirSync(`${contents}/MacOS`, { recursive: true });
mkdirSync(`${contents}/Frameworks`, { recursive: true });
const build = Bun.spawnSync(
  [
    "bun",
    "build",
    "--compile",
    "./src/index.ts",
    "--external",
    "@gpuix/native-darwin-arm64",
    "--outfile",
    `${contents}/MacOS/re-overlay`,
  ],
  {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (build.exitCode !== 0) process.exit(build.exitCode);
for (const library of ["libpanel.dylib", "gpuix-native.darwin-arm64.node"])
  copyFileSync(resolve(import.meta.dir, `../dist/${library}`), `${contents}/Frameworks/${library}`);
writeFileSync(
  `${contents}/Info.plist`,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.simbyotic.re-overlay</string>
<key>CFBundleName</key><string>re Overlay</string>
<key>CFBundleExecutable</key><string>re-overlay</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.0.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`,
);
console.log(`Built ${contents}/..`);
