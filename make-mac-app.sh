#!/bin/bash
# Builds "Phone Knobs.app" into /Applications. Run once on your Mac:  ./make-mac-app.sh
# Run it again after you change any files, to update the app. Your layouts are not touched.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js (LTS) from nodejs.org first."; exit 1; }
npm install --omit=dev

APP="/Applications/Phone Knobs.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"
cp -R server.js package.json package-lock.json public node_modules "$APP/Contents/Resources/app/"
cp mac/PhoneKnobs "$APP/Contents/MacOS/PhoneKnobs"
chmod +x "$APP/Contents/MacOS/PhoneKnobs"
cp mac/Info.plist "$APP/Contents/Info.plist"

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s mac/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) mac/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"
echo "Done. Open Phone Knobs from Applications (or Launchpad)."
