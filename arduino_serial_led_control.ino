/*
 * ML Bridge - USB Serial LED Control for Arduino Uno R4 WiFi
 *
 * Receives classification predictions from Serial Bridge via USB Serial
 * Controls LED on pin 2:
 *   - class_1 → LED ON
 *   - class_2 → LED OFF
 *
 * Supports both JSON and CSV formats from Serial Bridge
 *
 * Setup in ML Bridge:
 * 1. Upload this sketch to Arduino
 * 2. In Serial Bridge app, select the Arduino's serial port
 * 3. In ML Bridge Deploy tab:
 *    - Protocol: Serial Bridge
 *    - Device ID: arduino (or whatever you named it in Serial Bridge)
 *    - Format: JSON or CSV
 */

const int LED_PIN = 2;

String receivedData = "";

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Brief startup blink to show Arduino is ready
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
}

void loop() {
  // Read incoming serial data
  while (Serial.available() > 0) {
    char c = Serial.read();

    // Accumulate data until newline or complete message
    if (c == '\n' || c == '\r') {
      if (receivedData.length() > 0) {
        processData(receivedData);
        receivedData = "";
      }
    } else {
      receivedData += c;
    }
  }

  // Also process if we have a complete JSON object
  if (receivedData.indexOf("}") > 0) {
    processData(receivedData);
    receivedData = "";
  }
}

void processData(String data) {
  // Remove whitespace
  data.trim();

  if (data.length() == 0)
    return;

  // DEBUG: Show what we received
  Serial.print("Received: ");
  Serial.println(data);

  String label = "";

  // Try to parse as JSON first
  if (data.indexOf("{") >= 0) {
    // JSON format: {"label":"class_1","confidence":0.85}
    int labelStart = data.indexOf("\"label\":\"");
    if (labelStart >= 0) {
      labelStart += 9; // Length of "label":"
      int labelEnd = data.indexOf("\"", labelStart);
      if (labelEnd > labelStart) {
        label = data.substring(labelStart, labelEnd);
      }
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

  // DEBUG: Show parsed label
  Serial.print("Parsed label: ");
  Serial.println(label);

  // Control LED based on class
  if (label.indexOf("class_1") >= 0 || label == "1") {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("→ LED ON");
  } else if (label.indexOf("class_2") >= 0 || label == "2") {
    digitalWrite(LED_PIN, LOW);
    Serial.println("→ LED OFF");
  } else {
    Serial.println("→ No match");
  }
}
