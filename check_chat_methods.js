
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: "test-key" });
console.log("Checking chat object...");
try {
    const chat = client.chats.create({ model: "gemini-1.5-flash" });
    console.log("chat object created");
    console.log("chat.sendMessage exists?", !!chat.sendMessage);
} catch (e) {
    console.log("Error creating chat:", e.message);
}
