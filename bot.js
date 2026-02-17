// ===== IMPORTS =====
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const VIP_LINK = process.env.VIP_LINK;
const USERS_FILE = './users.json';
const PORT = process.env.PORT || 3000;

if (!TOKEN || !ADMIN_ID || !VIP_LINK) {
  console.error('⚠️ Missing environment variables BOT_TOKEN, ADMIN_ID, or VIP_LINK!');
  process.exit(1);
}

// ===== INIT BOT & APP =====
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

// ===== USERS STORAGE =====
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getExpire(plan) {
  const now = new Date();
  if(plan === 'basic') now.setDate(now.getDate()+7);
  if(plan === 'premium') now.setDate(now.getDate()+30);
  if(plan === 'elite') return 'lifetime';
  return now.toISOString();
}

// ===== WEBHOOK SETUP =====
bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL}/${TOKEN}`);

app.post(`/${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== BOT LOGIC =====

// ===== START COMMAND =====
bot.onText(/\/start (.+)/, (msg, match) => {
  const payload = match[1]; // ex: "PREMIUM_username"
  const [planRaw, telegramRaw] = payload.split("_");
  const plan = planRaw.toLowerCase();
  const telegram = telegramRaw.replace('@',''); // Username sem @
  const userId = msg.chat.id;
  const name = msg.from.first_name;

  const users = loadUsers();
  if(!users[telegram]) users[telegram] = {};

  users[telegram] = {
    ...users[telegram],
    pendingPlan: plan,
    telegram,
    name,
    telegramId: userId
  };

  // Generate orderId
  const orderId = Math.floor(Math.random()*1000000);
  users[telegram].orderId = orderId;
  saveUsers(users);

  // ===== MESSAGE TO ADMIN =====
  let price = plan==='basic'?65:plan==='premium'?120:200;
  let days = plan==='basic'?7:plan==='premium'?30:'lifetime';

  bot.sendMessage(ADMIN_ID,
    `🆕 Order received\nPlan: ${plan.toUpperCase()}\nUsername: @${telegram}\nOrder ID: ${orderId}\nPrice: $${price}\nDuration: ${days} days`
  );

  // ===== MESSAGE TO CLIENT =====
  bot.sendMessage(userId,
    `✅ Order sent!\nPlan: ${plan.toUpperCase()}\nDuration: ${days} days\nPrice: $${price}\n\n📌 Please upload your payment proof to get the VIP link.`
  );
});

// ===== UPLOAD PAYMENT PROOF =====
bot.on('message', msg => {
  const userId = msg.chat.id;
  const users = loadUsers();
  const userEntry = Object.entries(users).find(([_, u]) => u.telegramId === userId);
  if(!userEntry) return; // usuário não encontrado

  const [telegram, user] = userEntry;

  if(msg.photo) {
    const fileId = msg.photo[msg.photo.length-1].file_id;
    bot.getFileLink(fileId).then(link => {
      if(!user.proofs) user.proofs = [];
      user.proofs.push(link);
      saveUsers(users);

      // notify user
      bot.sendMessage(userId, `📎 Screenshot received! Admin will verify and approve your order soon.`);

      // notify admin
      bot.sendMessage(ADMIN_ID,
        `📸 Payment screenshot received\nPlan: ${user.pendingPlan || user.plan}\nUsername: @${telegram}\nOrder ID: ${user.orderId}\nPrice: ${user.pendingPlan==='basic'?65:user.pendingPlan==='premium'?120:200}\nProof link: ${link}`
      );
    });
  }
});

// ===== APPROVE / REJECT COMMANDS =====
bot.onText(/\/approve (.+)/, msg => {
  if(msg.chat.id != ADMIN_ID) return;
  const telegram = msg.text.split(' ')[1].replace('@','');
  const users = loadUsers();
  const user = users[telegram];
  if(!user) return bot.sendMessage(ADMIN_ID,"User not found");

  const plan = user.pendingPlan;
  const expire = getExpire(plan);

  user.plan = plan;
  user.expires = expire;
  delete user.pendingPlan;
  saveUsers(users);

  bot.sendMessage(user.telegramId, `🎉 Payment confirmed!\nPlan: ${plan.toUpperCase()}\nJoin VIP here: ${VIP_LINK}`);
  bot.sendMessage(ADMIN_ID, `✅ Approved @${telegram} for plan ${plan.toUpperCase()}`);
});

bot.onText(/\/reject (.+)/, msg => {
  if(msg.chat.id != ADMIN_ID) return;
  const telegram = msg.text.split(' ')[1].replace('@','');
  const users = loadUsers();
  const user = users[telegram];
  if(!user) return bot.sendMessage(ADMIN_ID,"User not found");

  bot.sendMessage(user.telegramId, `❌ Payment rejected. Contact support in case of error: @wachazzin`);
  delete user.pendingPlan;
  saveUsers(users);
  bot.sendMessage(ADMIN_ID, `❌ Rejected @${telegram}`);
});

// ===== STATS =====
bot.onText(/\/stats/, msg => {
  if(msg.chat.id != ADMIN_ID) return;

  const users = loadUsers();
  let basic=0, premium=0, elite=0;
  Object.values(users).forEach(u=>{
    if(u.plan==='basic') basic++;
    if(u.plan==='premium') premium++;
    if(u.plan==='elite') elite++;
  });

  bot.sendMessage(ADMIN_ID, `📊 Subscribers:\nBasic: ${basic}\nPremium: ${premium}\nElite: ${elite}`);
});

// ===== DAILY REMINDERS =====
cron.schedule('0 12 * * *', () => {
  const users = loadUsers();
  const now = new Date();

  Object.keys(users).forEach(telegram=>{
    const user = users[telegram];
    if(user.expires && user.expires!=='lifetime') {
      const exp = new Date(user.expires);
      const diff = (exp-now)/(1000*60*60*24);

      if(diff <= 2 && diff > 1) {
        bot.sendMessage(user.telegramId, "⚠️ Your subscription expires soon.");
      }
      if(diff <=0){
        bot.sendMessage(user.telegramId, "⏰ Your subscription expired. Please renew.");
        delete user.plan;
        delete user.expires;
      }
    }
  });

  saveUsers(users);
});

// ===== START WEB SERVER =====
app.get('/', (req,res)=>res.send('Bot is running'));
app.listen(PORT, ()=>console.log('Web server running'));

