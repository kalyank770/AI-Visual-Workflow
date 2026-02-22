
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: "test-key" });
console.log("client.models exists?", !!client.models);
if (client.models) {
  console.log("client.models.generateContent exists?", !!client.models.generateContent);
}

console.log("client.chats exists?", !!client.chats);
if (client.chats) {
    console.log("client.chats.create exists?", !!client.chats.create);
}
