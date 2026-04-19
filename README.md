# NeuroPod — Gait Intelligence Dashboard

Real-time web dashboard for the NeuroPod peripheral neuropathy wearable.
Displays FSR foot pressure, center of pressure, calf haptic motor feedback,
step count, cadence, and session metrics.

## Quick start

```bash
# Option A — VS Code Live Server (recommended)
# 1. Install the "Live Server" extension in VS Code
# 2. Right-click index.html → "Open with Live Server"
# 3. Dashboard opens at http://127.0.0.1:5500

# Option B — Python
python3 -m http.server 5500
# then open http://localhost:5500
```

**Important**: BLE requires a secure context (https or localhost).
Live Server on localhost works fine. Do NOT just open index.html as a file:// URL.

## File structure

```
neuropod/
├── index.html          ← main page
├── css/
│   └── style.css       ← all styles
└── js/
    ├── data.js         ← sensor state, step detection, simulation
    ├── ui.js           ← all DOM rendering
    ├── ble.js          ← Web Bluetooth connection
    └── main.js         ← entry point + render loop
```

## Connecting to the ESP32

1. Open `js/ble.js` and update the two UUIDs to match your Arduino sketch:
   ```js
   const BLE_SERVICE_UUID = 'your-service-uuid-here';
   const BLE_CHAR_UUID    = 'your-characteristic-uuid-here';
   ```

2. Your ESP32 should send JSON packets every ~100ms via BLE notify:
   ```json
   {
     "fsr": [85, 60, 40, 35, 90, 75],
     "cop": {"x": 0.1, "y": -0.3},
     "imuFoot": {"ax": 0.1, "ay": 0.0, "az": 0.98},
     "imuCalf": {"ax": 0.0, "ay": 0.0, "az": 1.0},
     "step": false
   }
   ```
   - `fsr`: 6 values 0–100 (toe-L, toe-R, mid-L, mid-R, heel-L, heel-R)
   - `cop.x`: -1.0 (left) to +1.0 (right)
   - `cop.y`: -1.0 (toe) to +1.0 (heel)
   - `step`: `true` on each footfall (or omit and let the dashboard detect it)

3. Click "Connect device" in Chrome/Edge — a BLE scan dialog appears.
   Select your ESP32 device.

## Testing without hardware

Open the browser console and inject test packets:
```js
// Test left-shift scenario
injectPacket({fsr:[90,10,50,50,80,20], cop:{x:-0.5,y:0.1}})

// Test heel-heavy stance
injectPacket({fsr:[10,10,10,10,90,90], cop:{x:0,y:0.7}})

// Test toe-heavy stance
injectPacket({fsr:[80,80,80,80,10,10], cop:{x:0,y:-0.7}})
```

## Step detection

Step detection runs in `data.js`. Two thresholds control sensitivity:
- `STEP_ON  = 180` — total FSR pressure to begin a stance phase
- `STEP_OFF = 60`  — total FSR pressure to end stance (foot lifts)

Tune these once you have real sensor data.
If the ESP32 detects steps on-device, send `"step": true` in the packet
and the dashboard will use that instead.

## Adding features

- **Exercise mode**: Add a new panel in `index.html`, handle mode state in `data.js`
- **AMD GPU backend**: POST sensor data to a local Flask server, receive
  classification labels, display them in a new metric card
- **Session export**: Collect `_histData` over time in `data.js` and add a
  download button that saves to CSV
