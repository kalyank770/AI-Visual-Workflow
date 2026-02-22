
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: "test-key" });
console.log("client.models:", client.models);
console.log("client.models.generateContent:", client.models.generateContent);

console.log("client.chats:", client.chats);
console.log("client.chats.create:", client.chats.create);
