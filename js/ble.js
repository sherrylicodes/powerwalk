// js/ble.js

const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
const CHARACTERISTIC_UUID = "abcdefab-1234-1234-1234-abcdefabcdef";

let bleDevice = null;
let bleCharacteristic = null;

export async function connectToShoeBLE({ onConnected, onDisconnected, onData, onError }) {
  try {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not supported in this browser.");
    }

    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });

    bleDevice.addEventListener("gattserverdisconnected", () => {
      onDisconnected?.();
    });

    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    bleCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();

    bleCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      try {
        const value = event.target.value;
        const decoder = new TextDecoder("utf-8");
        const raw = decoder.decode(value);

        // Expecting JSON string from device
        const parsed = JSON.parse(raw);

        onData?.(parsed);
      } catch (err) {
        onError?.(err);
      }
    });

    onConnected?.(bleDevice);
    return bleDevice;
  } catch (err) {
    onError?.(err);
    throw err;
  }
}

export async function disconnectFromShoeBLE() {
  try {
    if (bleDevice?.gatt?.connected) {
      bleDevice.gatt.disconnect();
    }
  } catch (err) {
    console.error("BLE disconnect failed:", err);
  }
}