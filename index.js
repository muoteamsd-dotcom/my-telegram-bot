require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const express = require("express");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = "5299343602"; 

const dbPath = path.join(__dirname, "database.json");
let requestsDB = {};

if (fs.existsSync(dbPath)) {
  requestsDB = JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function saveDB() {
  fs.writeFileSync(dbPath, JSON.stringify(requestsDB, null, 2));
}

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { step: "idle", type: null, buffer: [], targetId: null, ratingLevel: null });
  }
  return sessions.get(id);
}

function resetSession(user) {
  user.step = "idle";
  user.type = null;
  user.buffer = [];
  user.targetId = null;
  user.ratingLevel = null;
}

function getAdminKeyboard(reqId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏳ قيد المراجعة", `admin_review_${reqId}`)],
    [Markup.button.callback("ℹ️ طلب معلومات إضافية", `admin_needinfo_${reqId}`)],
    [Markup.button.callback("✅ إرسال رد نهائي", `admin_done_${reqId}`)],
    [Markup.button.callback("❌ رفض الطلب", `admin_reject_${reqId}`)]
  ]);
}

const mainMenu = Markup.keyboard([
  ["🟦 شكوى", "🟨 مقترح"],
  ["⭐ تقييم أداء", "🔍 متابعة طلب"]
]).resize();

const finishCollectionMenu = Markup.keyboard([
  ["✔ الانتهاء من الإرسال", "❌ إلغاء الطلب"]
]).resize();

const reviewMenu = Markup.keyboard([
  ["✅ إرسال الآن", "❌ إلغاء الطلب"]
]).resize();

const ratingMenu = Markup.keyboard([
  ["🌟 ممتاز", "👍 جيد"],
  ["😐 متوسط", "📉 ضعيف"],
  ["❌ إلغاء الطلب"]
]).resize();

const cancelMenu = Markup.keyboard([["🔙 رجوع للقائمة الرئيسية"]]).resize();

bot.start((ctx) => {
  resetSession(getSession(ctx.from.id));
  return ctx.reply(
    "أهلاً بك.\nيمكنك من خلال هذا البوت تقديم شكوى أو مقترح أو تقييم أداء، ومتابعة حالة طلبك باستخدام رقم المتابعة.\n\nيرجى اختيار الخدمة المطلوبة من القائمة أدناه 👇",
    mainMenu
  );
});

bot.hears(["❌ إلغاء الطلب", "🔙 رجوع للقائمة الرئيسية"], (ctx) => {
  resetSession(getSession(ctx.from.id));
  return ctx.reply("🏠 تم الإلغاء والعودة للقائمة الرئيسية.", mainMenu);
});

bot.hears(["🟦 شكوى", "🟨 مقترح"], (ctx) => {
  const user = getSession(ctx.from.id);
  user.type = ctx.message.text.replace(/🟦 |🟨 /, "");
  user.step = "collect";
  user.buffer = [];
  return ctx.reply(
    `يرجى إرسال تفاصيل الـ ${user.type}.\nيمكنك إرسال نصوص، صور، فيديو، أو ملفات.\n\n(بعد الانتهاء من الإرسال، اضغط على "✔ الانتهاء من الإرسال" من الأسفل 👇)`,
    finishCollectionMenu
  );
});

bot.hears("⭐ تقييم أداء", (ctx) => {
  const user = getSession(ctx.from.id);
  user.type = "تقييم أداء";
  user.step = "rating_choose_level";
  return ctx.reply("يرجى اختيار مستوى التقييم من القائمة أدناه 👇", ratingMenu);
});

bot.hears(["🌟 ممتاز", "👍 جيد", "😐 متوسط", "📉 ضعيف"], (ctx) => {
  const user = getSession(ctx.from.id);
  if (user.step !== "rating_choose_level") return;
  user.ratingLevel = ctx.message.text;
  user.step = "collect";
  user.buffer = [];
  return ctx.reply(
    `لقد اخترت: ${user.ratingLevel}\nيرجى إرسال تفاصيل تقييم الأداء (نصوص أو وسائط).\n\n(بعد الانتهاء، اضغط على "✔ الانتهاء من الإرسال")`,
    finishCollectionMenu
  );
});

bot.hears("🔍 متابعة طلب", (ctx) => {
  getSession(ctx.from.id).step = "track";
  return ctx.reply("الرجاء إرسال رقم المتابعة الخاص بطلبك 👇\n(مثال: REQ-12345)", cancelMenu);
});

bot.hears("✔ الانتهاء من الإرسال", (ctx) => {
  const user = getSession(ctx.from.id);
  
  if (user.buffer.length === 0) {
    return ctx.reply("عفواً، لم تقم بإرسال أي محتوى! أرسل التفاصيل أولاً.", finishCollectionMenu);
  }

  if (user.step === "user_replying_admin") {
    user.step = "review_reply";
    return ctx.reply(`📑 **أنت على وشك إرسال رد للإدارة بـ (${user.buffer.length}) مرفقات.**\n\nإذا كنت متأكداً، اضغط على "✅ إرسال الآن".`, { parse_mode: "Markdown", ...reviewMenu });
  }

  if (user.step === "collect") {
    user.step = "review";
    let msg = `📑 **أنت على وشك إرسال الطلب بالبيانات التالية:**\n\n`;
    msg += `📌 **نوع الطلب:** ${user.type}\n`;
    if (user.ratingLevel) msg += `⭐ **مستوى التقييم:** ${user.ratingLevel}\n`;
    msg += `📎 **عدد العناصر المرفقة:** ${user.buffer.length}\n\n`;
    msg += `إذا كنت متأكداً، اضغط على "✅ إرسال الآن".`;
    return ctx.reply(msg, { parse_mode: "Markdown", ...reviewMenu });
  }
});

bot.hears("✅ إرسال الآن", async (ctx) => {
  const user = getSession(ctx.from.id);

  if (user.step === "review_reply") {
    const reqId = user.targetId;
    await bot.telegram.sendMessage(ADMIN_ID, `📤 **رد جديد من المستخدم على الطلب [${reqId}]:**\n\n👇 المحتوى أدناه:`, { parse_mode: "Markdown" });
    for (const msg of user.buffer) {
      await bot.telegram.copyMessage(ADMIN_ID, ctx.from.id, msg.message_id);
    }
    await bot.telegram.sendMessage(ADMIN_ID, `⚙️ **أدوات إدارة الطلب [${reqId}]:**`, { parse_mode: "Markdown", ...getAdminKeyboard(reqId) });

    resetSession(user);
    return ctx.reply(`✅ **تم إرسال ردك للإدارة بنجاح.**\nسيتم مراجعته في أقرب وقت.`, { parse_mode: "Markdown", ...mainMenu });
  }

  if (user.step === "review") {
    const reqId = "REQ-" + Math.floor(10000 + Math.random() * 90000);
    const dateNow = new Date().toLocaleString("ar-SA");

    requestsDB[reqId] = {
      userId: ctx.from.id,
      type: user.type,
      ratingLevel: user.ratingLevel,
      status: "جديد 🆕",
      date: dateNow,
      adminReply: "لا يوجد"
    };
    saveDB();

    try {
      let adminMsg = `📥 **طلب جديد وارد!**\n\n🆔 **رقم المتابعة:** \`${reqId}\`\n📌 **النوع:** ${user.type}\n`;
      if (user.ratingLevel) adminMsg += `⭐ **التقييم:** ${user.ratingLevel}\n`;
      adminMsg += `👤 **بواسطة:** @${ctx.from.username || "بدون يوزر"} (${ctx.from.id})\n📅 **التاريخ:** ${dateNow}\n\n👇 **المحتوى المرسل:**`;
      
      await bot.telegram.sendMessage(ADMIN_ID, adminMsg, { parse_mode: "Markdown" });

      for (const msg of user.buffer) {
        await bot.telegram.copyMessage(ADMIN_ID, ctx.from.id, msg.message_id);
      }

      await bot.telegram.sendMessage(
        ADMIN_ID,
        `⚙️ **أدوات إدارة الطلب [${reqId}]:**`,
        { parse_mode: "Markdown", ...getAdminKeyboard(reqId) }
      );
    } catch (err) {
      console.log("خطأ في إرسال الطلب للأدمن:", err);
    }

    const savedType = user.type;
    resetSession(user);

    return ctx.reply(
      `✅ **تم تسجيل طلبكم بنجاح.**\n\n📌 **نوع الطلب:** ${savedType}\n🆔 **رقم المتابعة:** \`${reqId}\`\n📊 **الحالة:** جديد 🆕\n\nيرجى الاحتفاظ برقم المتابعة للاستعلام عن حالة الطلب لاحقاً.`,
      { parse_mode: "Markdown", ...mainMenu }
    );
  }
});

bot.action(/admin_(review|needinfo|done|reject)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const reqId = ctx.match[2];
  const adminSession = getSession(ctx.from.id);
  const reqData = requestsDB[reqId];

  if (!reqData) return ctx.answerCbQuery("❌ هذا الطلب غير موجود!");

  if (action === "review") {
    reqData.status = "قيد المراجعة ⏳";
    saveDB();
    
    await ctx.editMessageText(
      `⚙️ **أدوات إدارة الطلب [${reqId}]:**\n\n✅ تم تحديث الحالة إلى: **قيد المراجعة ⏳**\n(يمكنك تغيير الحالة مجدداً من الأزرار أدناه 👇)`,
      { parse_mode: "Markdown", ...getAdminKeyboard(reqId) }
    );

    try {
      await bot.telegram.sendMessage(reqData.userId, `🔔 **تم تحديث حالة طلبكم.**\n\n🆔 رقم المتابعة: \`${reqId}\`\n📊 الحالة الحالية: **قيد المراجعة ⏳**\n\nيجري حالياً مراجعة الطلب من قبل الإدارة، وسيتم إشعاركم بأي تحديث.`, { parse_mode: "Markdown" });
    } catch(e) {}
    return;
  }

  adminSession.step = `admin_typing_${action}`;
  adminSession.targetId = reqId;

  let prompt = "";
  if (action === "needinfo") prompt = "✍️ يرجى كتابة الرسالة لطلب معلومات إضافية من المستخدم:";
  if (action === "done") prompt = "✍️ يرجى كتابة الرد النهائي (تمت المعالجة):";
  if (action === "reject") prompt = "✍️ يرجى كتابة سبب رفض الطلب:";

  await ctx.reply(prompt, Markup.keyboard([["❌ إلغاء الإجراء"]]).resize());
  ctx.answerCbQuery();
});

bot.action(/user_reply_(.+)/, async (ctx) => {
  const reqId = ctx.match[1];
  const user = getSession(ctx.from.id);
  user.step = "user_replying_admin";
  user.targetId = reqId;
  user.buffer = [];

  await ctx.reply(
    `📤 **الرد على الإدارة للطلب [${reqId}]**\nأرسل ما تم طلبه منك (نصوص، صور، أو ملفات).\n\n(بعد الانتهاء اضغط على "✔ الانتهاء من الإرسال" من الأسفل 👇)`,
    finishCollectionMenu
  );
  ctx.answerCbQuery();
});

bot.on("message", async (ctx) => {
  const user = getSession(ctx.from.id);
  const text = (ctx.message.text || ctx.message.caption || "").trim();

  const menuButtons = ["🟦 شكوى", "🟨 مقترح", "⭐ تقييم أداء", "🔍 متابعة طلب", "✔ الانتهاء من الإرسال", "✅ إرسال الآن", "❌ إلغاء الطلب", "🔙 رجوع للقائمة الرئيسية", "🌟 ممتاز", "👍 جيد", "😐 متوسط", "📉 ضعيف"];
  if (menuButtons.includes(text)) return;

  if (user.step.startsWith("admin_typing_")) {
    if (text === "❌ إلغاء الإجراء") {
      resetSession(user);
      return ctx.reply("تم إلغاء الإجراء الإداري.", mainMenu);
    }

    const reqId = user.targetId;
    const reqData = requestsDB[reqId];
    if (!reqData || !ctx.message.text) return ctx.reply("❌ يجب إرسال نص فقط للرد.");

    const action = user.step.split("_")[2];
    reqData.adminReply = text;

    let userMsg = "";
    if (action === "needinfo") {
      reqData.status = "بانتظار معلومات إضافية ⚠️";
      userMsg = `🔔 **تم تحديث حالة طلبكم.**\n\n🆔 رقم المتابعة: \`${reqId}\`\n📊 الحالة: **بانتظار معلومات إضافية ⚠️**\n\n📝 **المطلوب منكم:**\n${text}`;
    } else if (action === "done") {
      reqData.status = "تمت المعالجة ✅";
      userMsg = `🔔 **تم الانتهاء من معالجة طلبكم.**\n\n🆔 رقم المتابعة: \`${reqId}\`\n📊 الحالة: **تمت المعالجة ✅**\n\n📝 **رد الإدارة:**\n${text}\n\nشكراً لتواصلكم معنا.`;
    } else if (action === "reject") {
      reqData.status = "مرفوض ❌";
      userMsg = `🔔 **نود إشعاركم بأنه تم إغلاق طلبكم.**\n\n🆔 رقم المتابعة: \`${reqId}\`\n📊 الحالة: **مرفوض ❌**\n\n📝 **سبب الإجراء:**\n${text}`;
    }

    saveDB();
    resetSession(user);
    
    await ctx.reply("🏠 تمت العودة للقائمة الرئيسية.", mainMenu);
    await ctx.reply(
      `✅ **تم إرسال الرد وحفظ حالة الطلب [${reqId}].**\n\n⚙️ إذا أردت تحديث الحالة مجدداً في المستقبل، يمكنك استخدام الأزرار أدناه:`,
      { parse_mode: "Markdown", ...getAdminKeyboard(reqId) }
    );

    try {
      let extra = { parse_mode: "Markdown" };
      if (action === "needinfo") {
        extra.reply_markup = { inline_keyboard: [[{ text: "📤 إرسال الرد للإدارة", callback_data: `user_reply_${reqId}` }]] };
      }
      await bot.telegram.sendMessage(reqData.userId, userMsg, extra);
    } catch (e) {
      ctx.reply("⚠️ تم الحفظ ولكن المستخدم قام بحظر البوت ولا يمكن إرسال الإشعار إليه.");
    }
    return;
  }

  if (user.step === "user_replying_admin") {
    user.buffer.push(ctx.message);
    return ctx.reply("✅ تم الاستلام. أرسل المزيد أو اضغط ✔ الانتهاء من الإرسال.", finishCollectionMenu);
  }

  if (user.step === "collect") {
    user.buffer.push(ctx.message);
    return ctx.reply("✅ تم الاستلام.\n(يمكنك إرسال المزيد، أو الضغط على ✔ الانتهاء من الإرسال عند الانتهاء).", finishCollectionMenu);
  }

  if (user.step === "track") {
    const reqId = text.trim().toUpperCase();
    if (requestsDB[reqId]) {
      const data = requestsDB[reqId];
      resetSession(user);
      return ctx.reply(
        `📦 **تفاصيل الطلب:**\n\n` +
        `📌 **نوع الطلب:** ${data.type}\n` +
        `🆔 **رقم المتابعة:** \`${reqId}\`\n` +
        `📊 **الحالة:** ${data.status}\n` +
        `📅 **تاريخ التقديم:** ${data.date}\n` +
        `📝 **آخر تحديث من الإدارة:**\n${data.adminReply}`,
        { parse_mode: "Markdown", ...mainMenu }
      );
    } else {
      return ctx.reply("❌ رقم المتابعة غير صحيح، تأكد منه وحاول مرة أخرى.", cancelMenu);
    }
  }

  return ctx.reply("الرجاء اختيار أحد الخدمات من القائمة 👇", mainMenu);
});

const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive! 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Web server is running on port ${PORT}`);
  bot.launch().then(() => console.log("🔥 البوت الاحترافي شغال مية المية!"));
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
