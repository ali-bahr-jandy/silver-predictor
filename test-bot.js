// Simple standalone bot test
const { Telegraf } = require("telegraf");

const token = "8500749459:AAEMBs8FGxiyxc-HMvcK5KUA64H20Zc3CC4";
const bot = new Telegraf(token);

console.log("Starting bot...");

// Log all updates
bot.use((ctx, next) => {
  console.log("📩 Received update:", ctx.updateType, "from chat", ctx.chat?.id);
  return next();
});

// Handle /start
bot.command("start", (ctx) => {
  console.log("Got /start from:", ctx.chat.id);
  ctx.reply("Hello! Bot is working!");
});

// Handle any text
bot.on("text", (ctx) => {
  console.log("Got text:", ctx.message.text, "from:", ctx.chat.id);
  ctx.reply("I received: " + ctx.message.text);
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err.message);
});

// Launch
bot.telegram
  .deleteWebhook({ drop_pending_updates: true })
  .then(() => {
    console.log("Webhook cleared");
    return bot.launch();
  })
  .then(() => {
    console.log("Bot launched!");
  })
  .catch((err) => {
    console.error("Launch error:", err);
  });

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

console.log("Bot is now polling for messages...");
console.log("Send /start to @silverpredictorbot");
