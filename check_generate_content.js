
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: "test" });
try {
  // This will likely fail with invalid API key, but we want to know if the method exists and if `contents` is correct parameter
  client.models.generateContent({ 
    model: "test-model", 
    contents: "Hello world" 
  }).catch(e => {
    console.log("Error caught:", e.message);
  });
} catch (e) {
  console.log("Synchronous error:", e.message);
}
