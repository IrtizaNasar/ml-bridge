/*
 * ML Bridge - Bluetooth LED Control for Arduino Uno R4 WiFi
 * 
 * Receives classification predictions from Serial Bridge via Bluetooth
 * Controls LED on pin 2:
 *   - class_1 → LED ON
 *   - class_2 → LED OFF
 * 
 * Supports both JSON and CSV formats from Serial Bridge
 */

#include <ArduinoBLE.h>

// LED Configuration
const int LED_PIN = 2;

// BLE Service and Characteristic UUIDs (match Serial Bridge)
BLEService uartService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"); // Nordic UART Service
BLECharacteristic rxCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", BLEWrite, 512); // RX
BLECharacteristic txCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", BLENotify, 512); // TX

String receivedData = "";

void setup() {
  Serial.begin(115200);
  while (!Serial);
  
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  
  Serial.println("ML Bridge - Bluetooth LED Control");
  Serial.println("Initializing BLE...");
  
  if (!BLE.begin()) {
    Serial.println("Starting BLE failed!");
    while (1);
  }
  
  // Set BLE device name (this will appear in Serial Bridge)
  BLE.setLocalName("ML-Bridge-LED");
  BLE.setDeviceName("ML-Bridge-LED");
  
  // Set advertised service
  BLE.setAdvertisedService(uartService);
  
  // Add characteristics to service
  uartService.addCharacteristic(rxCharacteristic);
  uartService.addCharacteristic(txCharacteristic);
  
  // Add service
  BLE.addService(uartService);
  
  // Start advertising
  BLE.advertise();
  
  Serial.println("BLE device active, waiting for connections...");
  Serial.println("Device name: ML-Bridge-LED");
}

void loop() {
  // Wait for a BLE central to connect
  BLEDevice central = BLE.central();
  
  if (central) {
    Serial.print("Connected to: ");
    Serial.println(central.address());
    digitalWrite(LED_BUILTIN, HIGH); // Turn on built-in LED when connected
    
    while (central.connected()) {
      // Check if data was written to RX characteristic
      if (rxCharacteristic.written()) {
        int length = rxCharacteristic.valueLength();
        const uint8_t* value = rxCharacteristic.value();
        
        // Convert to string
        String data = "";
        for (int i = 0; i < length; i++) {
          data += (char)value[i];
        }
        
        receivedData += data;
        
        // Process complete messages (look for newline or complete JSON/CSV)
        processData(receivedData);
      }
    }
    
    digitalWrite(LED_BUILTIN, LOW); // Turn off built-in LED when disconnected
    Serial.println("Disconnected from central");
  }
}

void processData(String &data) {
  // Remove whitespace
  data.trim();
  
  if (data.length() == 0) return;
  
  Serial.print("Received: ");
  Serial.println(data);
  
  String label = "";
  
  // Try to parse as JSON first
  if (data.startsWith("{")) {
    // JSON format: {"label":"class_1","confidence":0.85}
    int labelStart = data.indexOf("\"label\":\"") + 9;
    int labelEnd = data.indexOf("\"", labelStart);
    if (labelStart > 8 && labelEnd > labelStart) {
      label = data.substring(labelStart, labelEnd);
    }
  } 
  // Try CSV format
  else if (data.indexOf(",") > 0) {
    // CSV format: class_1,0.85
    int commaIndex = data.indexOf(",");
    label = data.substring(0, commaIndex);
  }
  // Plain label
  else {
    label = data;
  }
  
  // Control LED based on class
  if (label.indexOf("class_1") >= 0 || label == "1") {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("→ LED ON (class_1)");
  } 
  else if (label.indexOf("class_2") >= 0 || label == "2") {
    digitalWrite(LED_PIN, LOW);
    Serial.println("→ LED OFF (class_2)");
  }
  else {
    Serial.print("→ Unknown class: ");
    Serial.println(label);
  }
  
  // Clear processed data
  data = "";
}
