/**
 * ============================================================
 *  ESP32-C3 Seeed Studio XIAO  |  BLE Raw Data Streamer
 * ============================================================
 *  Hardware:
 *    - Seeed Studio XIAO ESP32-C3
 *    - ADS1115   (I2C 0x48) → 4× FSR + 330Ω pulldown resistors
 *    - LSM6DS3   (I2C 0x6A) → Accel + Gyro  (SDO pin → GND)
 *                (use 0x6B if SDO pin → 3V3 — change LSM_ADDR)
 *    - All share: GND, 3V3, SDA (GPIO6 / D4), SCL (GPIO7 / D5)
 *
 *  LSM6DS3 driven via direct register writes — NO library needed.
 *    - Accel  : ±2 g     @ 416 Hz ODR
 *    - Gyro   : ±250 dps @ 416 Hz ODR
 *
 *  BLE Packet (CSV, newline-terminated, 50 Hz):
 *    ts_ms,fsr0,fsr1,fsr2,fsr3,ax,ay,az,gx,gy,gz\n
 *    - fsr0–3 : raw ADS1115 16-bit counts (±32768 @ ±4.096 V PGA)
 *    - ax–az  : raw accel 16-bit signed   (LSB = 0.061 mg  @ ±2 g)
 *    - gx–gz  : raw gyro  16-bit signed   (LSB = 8.75 mdps @ ±250 dps)
 *
 *  Libraries (Library Manager):
 *    • Adafruit ADS1X15   (Adafruit)
 *    • NimBLE-Arduino     (h2zero)  — tested with v2.x
 * ============================================================
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <NimBLEDevice.h>

// ============================================================
//  I2C pins  (XIAO ESP32-C3)
// ============================================================
#define SDA_PIN   6    // D4
#define SCL_PIN   7    // D5
#define I2C_FREQ  400000

// ============================================================
//  LSM6DS3 — register addresses
// ============================================================
#define LSM_ADDR       0x6B   // SDO → GND; change to 0x6B if SDO → 3V3
#define LSM_WHO_AM_I   0x0F   // expected value: 0x69
#define LSM_CTRL1_XL   0x10   // accel ODR / FS
#define LSM_CTRL2_G    0x11   // gyro  ODR / FS
#define LSM_CTRL3_C    0x12   // BDU + IF_INC
#define LSM_OUTX_L_G   0x22   // gyro  X low  (burst 0x22–0x2D = gyro+accel)
//
//  Register values used:
//    CTRL3_C  = 0x44  → BDU=1, IF_INC=1  (must set for burst reads)
//    CTRL2_G  = 0x60  → ODR=416 Hz, FS=±250 dps
//    CTRL1_XL = 0x60  → ODR=416 Hz, FS=±2 g

// ============================================================
//  BLE
// ============================================================
#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcdefab-cdef-cdef-cdef-abcdefabcdef"

// ============================================================
//  Sampling
// ============================================================
#define SAMPLE_RATE_HZ       50
#define SAMPLE_INTERVAL_MS   (1000 / SAMPLE_RATE_HZ)

// ============================================================
//  ADS1115
// ============================================================
#define ADS_GAIN   GAIN_ONE            // ±4.096 V → 0.125 mV/count
#define ADS_SPS    RATE_ADS1115_860SPS

// ============================================================
//  Globals
// ============================================================
Adafruit_ADS1115    ads;

NimBLEServer*         pServer         = nullptr;
NimBLECharacteristic* pCharacteristic = nullptr;
bool                  deviceConnected = false;
unsigned long         lastSampleTime  = 0;

// ============================================================
//  Raw IMU struct  — defined at file scope so all functions see it
// ============================================================
struct RawIMU {
  int16_t ax, ay, az;
  int16_t gx, gy, gz;
};

// ============================================================
//  LSM6DS3 helper: write one byte to a register
// ============================================================
static void lsmWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(LSM_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

// ============================================================
//  BLE callbacks  — NimBLE v2.x signatures
// ============================================================
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pSvr, NimBLEConnInfo& connInfo) override {
    deviceConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(NimBLEServer* pSvr, NimBLEConnInfo& connInfo, int reason) override {
    deviceConnected = false;
    Serial.println("[BLE] Client disconnected – restarting advertising");
    NimBLEDevice::startAdvertising();
  }
};

// ============================================================
//  Setup
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32-C3  FSR + LSM6DS3  BLE Streamer ===");

  // ── I2C ──────────────────────────────────────────────────
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(I2C_FREQ);

  // ── ADS1115 ──────────────────────────────────────────────
  if (!ads.begin(0x48)) {
    Serial.println("[ERROR] ADS1115 not found – check wiring");
    while (1) delay(100);
  }
  ads.setGain(ADS_GAIN);
  ads.setDataRate(ADS_SPS);
  Serial.println("[OK] ADS1115 ready");

  // ── LSM6DS3 — WHO_AM_I check ─────────────────────────────
  Wire.beginTransmission(LSM_ADDR);
  Wire.write(LSM_WHO_AM_I);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)LSM_ADDR, (uint8_t)1, (uint8_t)true);
  uint8_t whoami = Wire.read();

  if (whoami != 0x69) {
    Serial.print("[ERROR] LSM6DS3 WHO_AM_I = 0x");
    Serial.print(whoami, HEX);
    Serial.println("  (expected 0x69) – check SDO pin / I2C address");
    while (1) delay(100);
  }

  lsmWrite(LSM_CTRL3_C,  0x44);  // BDU=1, IF_INC=1
  lsmWrite(LSM_CTRL2_G,  0x60);  // gyro:  ODR=416 Hz, FS=±250 dps
  lsmWrite(LSM_CTRL1_XL, 0x60);  // accel: ODR=416 Hz, FS=±2 g
  Serial.print("[OK] LSM6DS3 ready  WHO_AM_I=0x");
  Serial.println(whoami, HEX);

  // ── BLE ──────────────────────────────────────────────────
  NimBLEDevice::init("XIAO_FSR_IMU");
  NimBLEDevice::setPower(3);    // +3 dBm; use 9 if your build supports it

  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  NimBLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY::NOTIFY
  );
  pService->start();

  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  NimBLEDevice::startAdvertising();

  Serial.println("[OK] BLE advertising as \"XIAO_FSR_IMU\"");
  Serial.println("Waiting for connection...");
  Serial.println("\nCSV: ts_ms,fsr0,fsr1,fsr2,fsr3,ax,ay,az,gx,gy,gz");
}

// ============================================================
//  Read all 4 FSR channels from ADS1115 (single-ended)
//  ~1.2 ms per channel at 860 SPS → ~5 ms total
// ============================================================
void readFSR(int16_t out[4]) {
  for (uint8_t ch = 0; ch < 4; ch++) {
    out[ch] = ads.readADC_SingleEnded(ch);
  }
}

// ============================================================
//  Burst-read LSM6DS3 gyro + accel  (12 bytes, little-endian)
//  Registers 0x22–0x2D are contiguous (gyro XYZ then accel XYZ)
// ============================================================
RawIMU readIMURaw() {
  RawIMU r;

  Wire.beginTransmission(LSM_ADDR);
  Wire.write(LSM_OUTX_L_G);       // start at gyro X low byte (0x22)
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)LSM_ADDR, (uint8_t)12, (uint8_t)true);

  // LSM6DS3 is little-endian: low byte arrives first
  r.gx = (int16_t)(Wire.read() | (Wire.read() << 8));
  r.gy = (int16_t)(Wire.read() | (Wire.read() << 8));
  r.gz = (int16_t)(Wire.read() | (Wire.read() << 8));
  r.ax = (int16_t)(Wire.read() | (Wire.read() << 8));
  r.ay = (int16_t)(Wire.read() | (Wire.read() << 8));
  r.az = (int16_t)(Wire.read() | (Wire.read() << 8));

  return r;
}

// ============================================================
//  Main loop
// ============================================================
void loop() {
  unsigned long now = millis();
  if (now - lastSampleTime < SAMPLE_INTERVAL_MS) return;
  lastSampleTime = now;

  int16_t fsr[4];
  readFSR(fsr);

  RawIMU imu = readIMURaw();

  // Build CSV string
  char buf[128];
  int len = snprintf(buf, sizeof(buf),
    "%lu,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d\n",
    now,
    fsr[0], fsr[1], fsr[2], fsr[3],
    imu.ax, imu.ay, imu.az,
    imu.gx, imu.gy, imu.gz
  );

  Serial.print(buf);

  if (deviceConnected) {
    pCharacteristic->setValue((uint8_t*)buf, len);
    pCharacteristic->notify();
  }
}
