// Run this to get your Telegram chat ID
// Usage: npx ts-node src/get-chat-id.ts

import axios from "axios";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not found in .env file");
  process.exit(1);
}

async function getChatId() {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
    );

    console.log("\n📱 Telegram Bot Updates:\n");

    if (response.data.result.length === 0) {
      console.log("No messages yet. Please:");
      console.log("1. Open Telegram");
      console.log("2. Search for @silverpredictorbot");
      console.log("3. Send /start to the bot");
      console.log("4. Run this script again");
      return;
    }

    const chatIds = new Set();
    for (const update of response.data.result) {
      if (update.message?.chat?.id) {
        const chat = update.message.chat;
        chatIds.add(chat.id);
        console.log(`Chat ID: ${chat.id}`);
        console.log(`  Username: @${chat.username || "N/A"}`);
        console.log(`  First Name: ${chat.first_name || "N/A"}`);
        console.log("");
      }
    }

    if (chatIds.size > 0) {
      console.log("\n✅ Add this to your .env file:");
      console.log(`TELEGRAM_CHAT_ID=${[...chatIds][0]}`);
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

getChatId();
