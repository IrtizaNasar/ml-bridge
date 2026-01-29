/*
  ML Bridge - USB Serial Regression Example
  Controls LED brightness based on "out_1" regression value (0.0 - 1.0)

  Wiring:
  - LED positive (long leg) -> Pin 3 (Must be a PWM pin like 3, 5, 6, 9, 10, 11
  on Uno)
  - LED negative (short leg) -> GND (through 220 ohm resistor)
*/

const int LED_PIN = 3; // Must be PWM pin
String receivedData = "";

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  analogWrite(LED_PIN, 0);
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (receivedData.length() > 0) {
        processData(receivedData);
        receivedData = "";
      }
    } else {
      receivedData += c;
    }
  }
}

void processData(String data) {
  data.trim();
  float value = 0.0;
  bool found = false;

  // 1. Try Parsing JSON: {"out_1":0.75, "out_2":0.1}
  if (data.indexOf("{") >= 0) {
    // Basic string parsing for "out_1":NUMBER
    int keyIndex = data.indexOf("\"out_1\":");
    if (keyIndex >= 0) {
      int valStart = keyIndex + 8; // length of "out_1":
      int valEnd = data.indexOf(",", valStart);
      if (valEnd == -1)
        valEnd = data.indexOf("}", valStart);

      if (valEnd > valStart) {
        String valStr = data.substring(valStart, valEnd);
        value = valStr.toFloat();
        found = true;
      }
    }
  }
  // 2. Try Parsing CSV: 0.75,0.10
  else if (data.indexOf(",") > 0 ||
           (data.toFloat() != 0.0 || data == "0.0" || data == "0")) {
    // Assume first value is out_1
    int commaIndex = data.indexOf(",");
    if (commaIndex > 0) {
      value = data.substring(0, commaIndex).toFloat();
    } else {
      value = data.toFloat();
    }
    found = true;
  }

  // 3. Map to PWM (0 - 255)
  if (found) {
    // Constrain to valid range 0.0 - 1.0
    if (value < 0.0)
      value = 0.0;
    if (value > 1.0)
      value = 1.0;

    int pwm = (int)(value * 255.0);
    analogWrite(LED_PIN, pwm);
  }
}
