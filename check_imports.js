
import { GoogleGenAI } from "@google/genai";

console.log("Exported GoogleGenAI:", GoogleGenAI);
try {
  const instance = new GoogleGenAI({ apiKey: "test-key" });
  console.log("Successfully created instance with { apiKey: 'test-key' }");
  console.log("Instance type:", instance.constructor.name);
} catch (e) {
  console.log("Error creating instance with object:", e.message);
}

try {
  const instance2 = new GoogleGenAI("test-key");
  console.log("Successfully created instance with string 'test-key'");
} catch (e) {
  console.log("Error creating instance with string:", e.message);
}
