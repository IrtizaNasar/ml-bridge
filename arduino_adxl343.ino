/*
 * ML Bridge - ADXL343 Accelerometer Example
 * 
 * Reads X, Y, Z acceleration from Adafruit ADXL343
 * Outputs JSON format for ML Bridge: {"x": 0.12, "y": -0.5, "z": 9.8}
 * 
 * Required Libraries (Install via Library Manager):
 * - Adafruit ADXL343
 * - Adafruit Unified Sensor
 */

#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL343.h>

/* Assign a unique ID to this sensor at the same time */
Adafruit_ADXL343 accel = Adafruit_ADXL343(12345);

void setup(void) {
  Serial.begin(115200);
  while (!Serial); // Wait for serial console
  
  // Serial.println("ADXL343 Accelerometer Test"); 
  // Commented out text that isn't JSON to avoid parsing errors in ML Bridge

  /* Initialise the sensor */
  if(!accel.begin()) {
    /* There was a problem detecting the ADXL343 ... check your connections */
    // Serial.println("Ooops, no ADXL343 detected ... Check your wiring!");
    while(1);
  }

  /* Set the range to whatever is appropriate for your project */
  accel.setRange(ADXL343_RANGE_16_G);
  
  // Optional: Set data rate
  // accel.setDataRate(ADXL343_DATARATE_100_HZ);
}

void loop(void) {
  /* Get a new sensor event */
  sensors_event_t event;
  accel.getEvent(&event);

  /* Display the results (acceleration is measured in m/s^2) */
  // Format: {"x": val, "y": val, "z": val}
  
  Serial.print("{\"x\":");
  Serial.print(event.acceleration.x);
  Serial.print(",\"y\":");
  Serial.print(event.acceleration.y);
  Serial.print(",\"z\":");
  Serial.print(event.acceleration.z);
  Serial.println("}");

  delay(20); // ~50Hz update rate
}
