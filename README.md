# Phone Knobs

Turn your phone into a hardware-style synth panel for your plugins: 12 knobs, pitch and mod wheels, and a hold button.

The phone page sends moves to a small program on your computer, which turns them into MIDI messages and sends them to a MIDI port your plugins and DAW can listen to. MIDI coming back from the DAW moves the phone's controls too.

## Default mapping

| Control | MIDI |
|---|---|
| Cutoff | CC 74 |
| Resonance | CC 71 |
| Ten unnamed knobs (free, for MIDI learn) | CC 20-29 |
| Mod wheel | CC 1 |
| Hold | CC 64 |
| Pitch wheel | Pitch bend |

Pitch bend, mod wheel and hold are standard MIDI and work in almost every plugin. Cutoff and resonance use the General MIDI sound-controller CCs that many synths respond to by default. The ten Knob slots are unmapped: MIDI-learn each one to whatever you like.

## Using two plugins at once

Every page has its own MIDI channel (shown on the tab, e.g. CH 2). Pitch, mod, hold and all knobs on a page are sent on that page's channel. Make one page per plugin, give each a different channel (new pages pick the next free one), and set each plugin or track in your DAW to listen on its own channel. Switching pages then switches which plugin you control. The phone can't see which plugin has focus; the channel is what keeps them apart. Each page also remembers its own mod wheel position. Tap a knob's name (or its dial in Edit mode) to rename it or change its CC; Page Settings has "Reset Knob Mapping".

## One-time setup

1. Install Node.js (the LTS version) from nodejs.org.
2. Open a terminal in this folder and run: `npm install`
3. **Windows only:** install loopMIDI (free, from Tobias Erichsen) and create a port with "+". Leave loopMIDI running whenever you play. For feedback from your DAW (see below) create a second port.
   **Mac:** nothing to install. The program creates a port called "Phone Knobs" by itself.

## Every time you play

1. In the terminal, run: `npm start`
2. It prints an address like `http://192.168.1.20:3000` and a QR code. Open that on your phone. Phone and computer must be on the same Wi-Fi.
3. On Windows, the first run asks if Node.js may use the network. Allow it for private networks.
4. Tip: use "Add to Home Screen" in your phone browser to get it full screen.

## Android app (instead of the browser)

`android-app/` is a small native app: full screen, always landscape, screen stays on, and it remembers your computer's address. It just shows the page from your computer, so MIDI still goes through the program as before.

**Get the APK (no Android Studio needed):**
1. Put this folder in a GitHub repository (private is fine) and push it to the `main` branch.
2. On GitHub open the **Actions** tab, then **Build Android APK**. It runs by itself on every push, or press **Run workflow**. It takes a few minutes.
3. Open the finished run, download the **phone-knobs-apk** file at the bottom, and unzip it to get `app-debug.apk`.
4. Copy it to your phone and open it. Android asks once to allow installing from this source: allow it.

**First start:** run `npm start` on your computer, then open the app, type the address the program prints (for example `192.168.1.20:3000`) and press Connect. After that the app goes straight to the knobs. If your computer's address changes (new Wi-Fi), press back twice quickly to get the address screen again.

If you have Android Studio you can instead open the `android-app` folder and press Run.

## Mac app (double-click to start)

1. Install Node.js (LTS) from nodejs.org, once.
2. In Terminal, in this folder, run: `./make-mac-app.sh`
   This puts **Phone Knobs** in your Applications folder. Run it again whenever you change the files.
3. Open **Phone Knobs**. A window shows the address to open on your phone. The first time, macOS asks if it may accept network connections: click Allow.
4. In FL Studio: Options, MIDI settings, Input. Select **Phone Knobs** and enable it. If it isn't listed, open Phone Knobs first, then click "Refresh device list".
5. Click **Quit** in the Phone Knobs window to stop it. To start it at every login: System Settings, General, Login Items, add Phone Knobs.

Your pages and knobs are saved in `~/Library/Application Support/Phone Knobs/layouts.v2.json`. Keep each knob's CC number and channel the same and the links you made in your DAW or plugin keep working. If you used an earlier version, your old layout was copied to a `layouts.v*-backup.json` file in the same folder.

## Two-way sync (plugin/DAW to phone)

The phone's knobs, wheels and Hold follow incoming MIDI in real time. Your DAW has to send the values out: enable the **Phone Knobs** MIDI output in your DAW (Mac), or your second loopMIDI port (Windows; the server listens to the second loopMIDI port automatically, or pick it with `--in=name`). A plugin's preset change only reaches the phone if the plugin or DAW sends those CCs out; many plugins don't, so test with yours. The status text on the phone shows `I/O:` when the feedback port is open and `OUT:` when it isn't.

## Connect a knob to a plugin

1. In your plugin (or DAW), enable the MIDI port as an input: "Phone Knobs" on Mac, your loopMIDI port on Windows.
2. Right-click the plugin knob you want and choose MIDI learn.
3. Move the matching knob on the phone, or tap the knob's name, then **Send MIDI Learn Sweep**.

Use one page per plugin (+ New Synth Page).

## Plugins without MIDI learn

Some plugins have no MIDI learn inside the plugin. Use the MIDI mapping in your DAW (Ableton, Reaper, FL Studio and others) and learn the plugin's parameter there. The phone side works the same.

## If something doesn't work

- **The phone can't open the page.** Some campus and public Wi-Fi networks stop devices from seeing each other. Use your phone's hotspot instead.
- **The phone says "TEST MODE".** Windows: loopMIDI isn't running or has no port. To pick a port by name: `node server.js --port=name`.
- **The plugin never hears the knob.** Check that the MIDI port is enabled as an input and the channel matches.
- **Change the web port.** Mac: `PORT=4000 npm start`. Windows: `set PORT=4000 && npm start`.

## Files

- `server.js`: the program on your computer (web server, MIDI out and feedback in)
- `public/`: the phone page (`index.html`, `app.js`, `sheets.js`, `sw.js`, `manifest.json`, `fonts/`)
- `mac/`: files used to build the Mac app
- `android-app/`: the Android app project; `.github/workflows/build-apk.yml` builds it on GitHub
- `layouts.v2.json`: your saved layouts (created on first use)
# MiniKnobsV
