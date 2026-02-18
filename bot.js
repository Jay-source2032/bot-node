const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const cron = require('node-cron');

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const VIP_LINK = process.env.VIP_LINK;
const URL = process.env.RENDER_EXTERNAL_URL;

if (!TOKEN || !ADMIN_ID || !VIP_LINK || !URL) {
  console.log("Missing ENV variables");
  process.exit(1);
}

// ===== INIT =====
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

bot.setWebHook(`${URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req,res)=>res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// ===== STORAGE =====
const FILE = './users.json';

function loadUsers() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE));
}

function saveUsers(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let users = loadUsers();

// ===== PLANS =====
function getPlan(plan){
  if(plan==="basic") return {price:65, days:7};
  if(plan==="premium") return {price:120, days:30};
  if(plan==="elite") return {price:200, days:9999};
  return null;
}

// ===== START =====
bot.onText(/\/start (.+)/, (msg, match)=>{
  const chatId = msg.chat.id;
  const name = msg.from.first_name;
  const payload = match[1];

  const [planRaw, usernameRaw] = payload.split("_");
  const plan = planRaw.toLowerCase();
  const username = usernameRaw.replace("@","");

  const planData = getPlan(plan);
  if(!planData) return;

  const orderId = Math.floor(Math.random()*1000000);

  users[chatId] = {
    chatId,
    username,
    name,
    pendingPlan: plan,
    orderId,
    created: new Date().toISOString()
  };

  saveUsers(users);

  // ===== CLIENT =====
  bot.sendMessage(chatId,
`✅ Order received

Order ID: ${orderId}

Plan: ${plan.toUpperCase()}
Duration: ${planData.days === 9999 ? "Lifetime" : planData.days + " days"}
Price: $${planData.price}

Username: @${username}

Please send your payment screenshot here.
After approval you will receive your VIP link automatically.`
  );

  // ===== ADMIN =====
  bot.sendMessage(ADMIN_ID,
`📦 Order sent

Order ID: ${orderId}
User: @${username}
Name: ${name}
ChatID: ${chatId}

Plan: ${plan.toUpperCase()}
Price: $${planData.price}`,
{
  reply_markup:{
    inline_keyboard:[[
      {text:"Approve ✅", callback_data:`approve_${chatId}`},
      {text:"Reject ❌", callback_data:`reject_${chatId}`}
    ]]
  }
});
});

// ===== RECEIVE PHOTO =====
bot.on('photo', msg=>{
  const chatId = msg.chat.id;
  if(!users[chatId]) return;

  const fileId = msg.photo[msg.photo.length-1].file_id;

  bot.sendPhoto(ADMIN_ID, fileId, {
    caption:`📸 Payment Proof

Order ID: ${users[chatId].orderId}
User: @${users[chatId].username}
ChatID: ${chatId}
Plan: ${users[chatId].pendingPlan}`
  });

  bot.sendMessage(chatId,"Screenshot received. Waiting for admin approval.");
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', async q=>{
  const data = q.data;
  const chatId = Number(data.split("_")[1]);

  if(!users[chatId]){
    bot.answerCallbackQuery(q.id,{text:"User not found"});
    return;
  }

  const user = users[chatId];

  if(data.startsWith("approve")){
    const planData = getPlan(user.pendingPlan);
    const expire = new Date();
    expire.setDate(expire.getDate()+planData.days);

    user.plan = user.pendingPlan;
    user.expires = planData.days===9999 ? "lifetime" : expire.toISOString();
    delete user.pendingPlan;

    saveUsers(users);

    bot.sendMessage(chatId,
`🎉 Payment confirmed!

Plan: ${user.plan.toUpperCase()}

Join VIP:
${VIP_LINK}`
    );

    bot.answerCallbackQuery(q.id,{text:"Approved"});
  }

  if(data.startsWith("reject")){
    delete user.pendingPlan;
    saveUsers(users);

    bot.sendMessage(chatId,
"❌ Payment rejected.\nContact support: @wachazzin"
    );

    bot.answerCallbackQuery(q.id,{text:"Rejected"});
  }
});

// ===== ADMIN COMMANDS =====

// Stats
bot.onText(/\/stats/, msg=>{
  if(msg.chat.id!==ADMIN_ID) return;

  let basic=0,premium=0,elite=0;

  Object.values(users).forEach(u=>{
    if(u.plan==="basic") basic++;
    if(u.plan==="premium") premium++;
    if(u.plan==="elite") elite++;
  });

  bot.sendMessage(ADMIN_ID,
`📊 Subscribers

Basic: ${basic}
Premium: ${premium}
Elite: ${elite}`
  );
});

// List users
bot.onText(/\/users/, msg=>{
  if(msg.chat.id!==ADMIN_ID) return;

  let text="Users:\n";
  Object.values(users).slice(-20).forEach(u=>{
    text += `@${u.username} | ${u.plan || "pending"} | ${u.chatId}\n`;
  });

  bot.sendMessage(ADMIN_ID,text);
});

// ===== EXPIRATION CHECK =====
cron.schedule('0 12 * * *', ()=>{
  const now = new Date();

  Object.values(users).forEach(u=>{
    if(u.expires && u.expires!=="lifetime"){
      const exp = new Date(u.expires);
      const diff = (exp-now)/(1000*60*60*24);

      if(diff<=2 && diff>1){
        bot.sendMessage(u.chatId,"Your subscription expires soon.");
      }

      if(diff<=0){
        bot.sendMessage(u.chatId,"Subscription expired.");
        delete u.plan;
        delete u.expires;
      }
    }
  });

  saveUsers(users);
});
