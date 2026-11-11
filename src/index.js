var TZ_OFFSET = 5 * 60 * 60 * 1e3;
var DAY = 24 * 60 * 60 * 1e3;
var DEFAULT_ALERTS = [7, 1];
var ALERT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 14, 30];
var MAX_ALERTS = 5;
var MAX_ALERT_DAYS = 365;
var MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь"
];
var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
var pad = (n) => String(n).padStart(2, "0");
var escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var tashkentNow = () => new Date(Date.now() + TZ_OFFSET);
var tashkentToUtc = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) - TZ_OFFSET;
var WEEKDAYS_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
var weekdayOf = (y, m, d) => WEEKDAYS_FULL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
function formatTashkent(ms) {
  const t = new Date(ms + TZ_OFFSET);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} (${WEEKDAYS_FULL[t.getUTCDay()]}) ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
var todayStr = () => {
  const t = tashkentNow();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
function ruDays(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11)
    return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14))
    return "дня";
  return "дней";
}
var parseAlerts = (s) => (s || "").split(",").filter(Boolean).map(Number);
var joinAlerts = (arr) => [...new Set(arr)].sort((a, b) => b - a).join(",");
function computeNextAt(eventAt, alerts, notifiedUntil) {
  let next = eventAt;
  for (const d of alerts) {
    const t = eventAt - d * DAY;
    if (t > notifiedUntil && t < next)
      next = t;
  }
  return next;
}
var btn = (text, data) => ({ text, callback_data: data });
var IGNORE = btn(" ", "ign");
async function tg(env, method, body) {
  const res = await fetch(`${env.TG_API || "https://api.telegram.org"}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.ok)
    console.log(`Telegram ${method} failed:`, JSON.stringify(json));
  return json;
}
var send = (env, chat_id, text, reply_markup) => tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", reply_markup });
var edit = (env, chat_id, message_id, text, reply_markup) => tg(env, "editMessageText", { chat_id, message_id, text, parse_mode: "HTML", reply_markup });
var getState = (env, chatId) => env.DB.prepare("SELECT text, edit_id, mode, shared FROM pending WHERE chat_id = ?").bind(chatId).first();
var setInputMode = (env, chatId, id, mode) => env.DB.prepare(
  "INSERT INTO pending (chat_id, text, edit_id, mode) VALUES (?, '', ?, ?) ON CONFLICT(chat_id) DO UPDATE SET text = '', edit_id = excluded.edit_id, mode = excluded.mode"
).bind(chatId, id, mode).run();
var activeAlerts = (r) => parseAlerts(r.alerts).filter((d) => r.event_at - d * DAY > Date.now());
var clearState = (env, chatId) => env.DB.prepare("DELETE FROM pending WHERE chat_id = ?").bind(chatId).run();
var sharedMembers = (env) => (env.ALLOWED_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
var isMember = (env, userId) => sharedMembers(env).includes(Number(userId));
var getReminder = (env, chatId, id) => env.DB.prepare("SELECT * FROM reminders WHERE id = ? AND (chat_id = ? OR (shared = 1 AND ?))").bind(id, chatId, isMember(env, chatId) ? 1 : 0).first();
async function listReminders(env, chatId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE chat_id = ? OR (shared = 1 AND ?) ORDER BY event_at"
  ).bind(chatId, isMember(env, chatId) ? 1 : 0).all();
  return results;
}
async function notifyOthers(env, fromId, text) {
  for (const id of sharedMembers(env)) {
    if (id !== Number(fromId))
      await send(env, id, text);
  }
}
var userName = (from) => escapeHtml(from?.first_name || from?.username || "Кто-то");
async function updateSchedule(env, r, { eventAt = r.event_at, alerts = parseAlerts(r.alerts) } = {}) {
  const now = Date.now();
  const nextAt = computeNextAt(eventAt, alerts, now);
  await env.DB.prepare(
    "UPDATE reminders SET event_at = ?, alerts = ?, notified_until = ?, next_at = ? WHERE id = ?"
  ).bind(eventAt, joinAlerts(alerts), now, nextAt, r.id).run();
}
function alertsLine(r) {
  const active = activeAlerts(r);
  if (!active.length)
    return "🔔 Предупреждения: нет (только в момент события)";
  return "🔔 Предупредить: " + active.map((d) => `за ${d} ${ruDays(d)}`).join(", ");
}
var card = (r) => `${r.shared ? "👥 <i>Общее событие</i>\n" : ""}📝 <b>${escapeHtml(r.text)}</b>
📅 ${formatTashkent(r.event_at)} (Ташкент)
${alertsLine(r)}`;
var help = (env, chatId) => "👋 Привет! Я бот-напоминалка.\n\nПо умолчанию предупреждаю за 7 дней и за 1 день, а также в сам момент события, после чего удаляю запись.\n\n" + (isMember(env, chatId) ? "👥 Общие события видят, изменяют и получают все участники.\n\n" : "") + "/list — мои напоминания\n/edit — изменить напоминание\n/delete — удалить напоминание";
function calendarKeyboard(year, month, id = 0) {
  const now = tashkentNow();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  const curD = now.getUTCDate();
  const rows = [];
  rows.push([btn(`${MONTHS[month - 1]} ${year}`, "ign")]);
  rows.push(WEEKDAYS.map((d) => btn(d, "ign")));
  const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let row = Array(firstDow).fill(IGNORE);
  for (let day = 1; day <= daysInMonth; day++) {
    const isPast = year < curY || year === curY && month < curM || year === curY && month === curM && day < curD;
    row.push(isPast ? IGNORE : btn(String(day), `day:${id}:${year}-${pad(month)}-${pad(day)}`));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length)
    rows.push([...row, ...Array(7 - row.length).fill(IGNORE)]);
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const prevIsPast = prev[0] < curY || prev[0] === curY && prev[1] < curM;
  rows.push([
    prevIsPast ? IGNORE : btn("<", `nav:${id}:${prev[0]}-${prev[1]}`),
    IGNORE,
    btn(">", `nav:${id}:${next[0]}-${next[1]}`)
  ]);
  rows.push([id ? btn("⬅️ Назад", `ed:${id}`) : btn("❌ Отмена", "cancel")]);
  return { inline_keyboard: rows };
}
function hoursKeyboard(date, id = 0) {
  const isToday = date === todayStr();
  const curH = tashkentNow().getUTCHours();
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 6; c++) {
      const h = r * 6 + c;
      row.push(isToday && h <= curH ? IGNORE : btn(`${pad(h)}:00`, `hr:${id}:${date}:${pad(h)}`));
    }
    rows.push(row);
  }
  rows.push([
    btn("⬅️ Назад", `nav:${id}:${date.slice(0, 4)}-${Number(date.slice(5, 7))}`),
    id ? btn("✖️ К напоминанию", `ed:${id}`) : btn("❌ Отмена", "cancel")
  ]);
  return { inline_keyboard: rows };
}
function alertsKeyboard(r) {
  const now = Date.now();
  const selected = new Set(parseAlerts(r.alerts));
  const rows = [];
  for (let i = 0; i < ALERT_OPTIONS.length; i += 3) {
    rows.push(
      ALERT_OPTIONS.slice(i, i + 3).map((d) => {
        if (r.event_at - d * DAY <= now)
          return IGNORE;
        return btn(`${selected.has(d) ? "✅" : "▫️"} ${d} ${ruDays(d)}`, `alt:${r.id}:${d}`);
      })
    );
  }
  const visible = rows.filter((row) => row.some((b) => b !== IGNORE));
  const custom = activeAlerts(r).filter((d) => !ALERT_OPTIONS.includes(d)).sort((a, b) => a - b);
  for (let i = 0; i < custom.length; i += 3) {
    visible.push(custom.slice(i, i + 3).map((d) => btn(`✅ ${d} ${ruDays(d)}`, `alt:${r.id}:${d}`)));
  }
  visible.push([btn("✍️ Ввести вручную", `alm:${r.id}`)]);
  visible.push([btn("✅ Готово", `ed:${r.id}`)]);
  return { inline_keyboard: visible };
}
var alertsPrompt = (r) => `${card(r)}

За сколько дней предупредить? Нажмите, чтобы включить/выключить (максимум ${MAX_ALERTS}).
В сам момент события я напомню в любом случае.`;
async function toggleAlert(env, r, d, { addOnly = false } = {}) {
  const set = new Set(parseAlerts(r.alerts));
  const isActive = activeAlerts(r).includes(d);
  if (addOnly && isActive)
    return `⚠️ Предупреждение за ${d} ${ruDays(d)} уже есть.`;
  if (isActive) {
    set.delete(d);
  } else {
    if (r.event_at - d * DAY <= Date.now()) {
      const left = Math.floor((r.event_at - Date.now()) / DAY);
      return `⚠️ Слишком поздно: до события ${left > 0 ? `${left} ${ruDays(left)}` : "меньше дня"}.`;
    }
    if (activeAlerts(r).length >= MAX_ALERTS) {
      return `⚠️ Можно не больше ${MAX_ALERTS} предупреждений. Сначала выключите одно.`;
    }
    set.add(d);
  }
  await updateSchedule(env, r, { alerts: [...set] });
  r.alerts = joinAlerts([...set]);
  return null;
}
function editMenuKeyboard(env, chatId, r) {
  const id = r.id;
  const rows = [
    [btn("📅 Изменить дату и время события", `ecal:${id}`)],
    [btn("🔔 Изменить время предупреждения", `al:${id}`)],
    [btn("✏️ Изменить название события", `ren:${id}`)]
  ];
  if (isMember(env, chatId)) {
    rows.push([btn(r.shared ? "👤 Сделать личным" : "👥 Сделать общим", `shr:${id}`)]);
  }
  rows.push([btn("🗑 Удалить", `dl:${id}:e`)], [btn("⬅️ К списку", "elist")]);
  return { inline_keyboard: rows };
}
function pickerMessage(reminders, mode) {
  if (!reminders.length)
    return { text: "📭 У вас нет напоминаний.", markup: void 0 };
  const lines = reminders.map(
    (r, i) => `${i + 1}. ${r.shared ? "👥 " : ""}<b>${escapeHtml(r.text)}</b> — ${formatTashkent(r.event_at)}`
  );
  const keyboard = reminders.map((r, i) => [
    btn(
      `${mode === "e" ? "✏️" : "🗑"} ${i + 1}. ${r.shared ? "👥 " : ""}${r.text.slice(0, 30)}`,
      mode === "e" ? `ed:${r.id}` : `dl:${r.id}:l`
    )
  ]);
  const title = mode === "e" ? "✏️ Какое напоминание изменить?" : "🗑 Какое напоминание удалить?";
  return { text: `${title}

${lines.join("\n")}`, markup: { inline_keyboard: keyboard } };
}
async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text)
    return;
  const command = text.startsWith("/") ? text.split(/[\s@]/)[0] : null;
  if (command === "/start" || command === "/help") {
    await clearState(env, chatId);
    return send(env, chatId, help(env, chatId));
  }
  if (command === "/list") {
    const reminders = await listReminders(env, chatId);
    if (!reminders.length)
      return send(env, chatId, "📭 У вас нет напоминаний.");
    const body = reminders.map((r, i) => `${i + 1}. ${card(r)}`).join("\n\n");
    return send(env, chatId, `📋 Ваши напоминания:

${body}`);
  }
  if (command === "/edit" || command === "/delete") {
    await clearState(env, chatId);
    const { text: t, markup } = pickerMessage(await listReminders(env, chatId), command === "/edit" ? "e" : "l");
    return send(env, chatId, t, markup);
  }
  if (command)
    return send(env, chatId, help(env, chatId));
  if (text.length > 500)
    return send(env, chatId, "⚠️ Слишком длинный текст (максимум 500 символов).");
  const state = await getState(env, chatId);
  if (state && state.edit_id) {
    const r = await getReminder(env, chatId, state.edit_id);
    if (!r) {
      await clearState(env, chatId);
      return send(env, chatId, "⚠️ Напоминание не найдено (уже прошло или удалено).");
    }
    if (state.mode === "alert") {
      const back = { inline_keyboard: [[btn("⬅️ Назад", `al:${r.id}`)]] };
      if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_ALERT_DAYS) {
        return send(env, chatId, `⚠️ Введите число от 1 до ${MAX_ALERT_DAYS}, например <code>10</code>`, back);
      }
      const d = Number(text);
      const error = await toggleAlert(env, r, d, { addOnly: true });
      if (error)
        return send(env, chatId, `${error}
Введите другое число:`, back);
      await clearState(env, chatId);
      return send(env, chatId, `✅ Добавлено: за ${d} ${ruDays(d)}

${alertsPrompt(r)}`, alertsKeyboard(r));
    }
    await clearState(env, chatId);
    await env.DB.prepare("UPDATE reminders SET text = ? WHERE id = ?").bind(text, r.id).run();
    r.text = text;
    return send(env, chatId, `✅ Название изменено.

${card(r)}

Что ещё изменить?`, editMenuKeyboard(env, chatId, r));
  }
  await env.DB.prepare(
    "INSERT INTO pending (chat_id, text, edit_id, mode, shared) VALUES (?, ?, NULL, NULL, 0) ON CONFLICT(chat_id) DO UPDATE SET text = excluded.text, edit_id = NULL, mode = NULL, shared = 0"
  ).bind(chatId, text).run();
  if (isMember(env, chatId)) {
    return send(env, chatId, `📝 <b>${escapeHtml(text)}</b>

Для кого это событие?`, {
      inline_keyboard: [
        [btn("👤 Для себя", "who:0"), btn("👥 Общее", "who:1")],
        [btn("❌ Отмена", "cancel")]
      ]
    });
  }
  const now = tashkentNow();
  return send(
    env,
    chatId,
    `📝 <b>${escapeHtml(text)}</b>

📅 Выберите дату:`,
    calendarKeyboard(now.getUTCFullYear(), now.getUTCMonth() + 1)
  );
}
async function handleCallback(env, cq) {
  const data = cq.data || "";
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const reply = (text, markup) => edit(env, chatId, msgId, text, markup);
  const [action, ...args] = data.split(":");
  if (action !== "alt")
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  if (data === "ign")
    return;
  const id = Number(args[0]) || 0;
  const NOT_FOUND = "⚠️ Напоминание не найдено (уже прошло или удалено).";
  if (action === "elist" || action === "dlist") {
    const { text, markup } = pickerMessage(await listReminders(env, chatId), action === "elist" ? "e" : "l");
    return reply(text, markup);
  }
  if (action === "cancel") {
    await clearState(env, chatId);
    return reply("❌ Отменено.");
  }
  if (action === "who") {
    const state = await getState(env, chatId);
    if (!state || state.edit_id)
      return reply("⚠️ Сессия устарела. Напишите название события заново.");
    const shared = id === 1 && isMember(env, chatId) ? 1 : 0;
    await env.DB.prepare("UPDATE pending SET shared = ? WHERE chat_id = ?").bind(shared, chatId).run();
    const now = tashkentNow();
    return reply(
      `${shared ? "👥 <i>Общее событие</i>\n" : ""}📝 <b>${escapeHtml(state.text)}</b>

📅 Выберите дату:`,
      calendarKeyboard(now.getUTCFullYear(), now.getUTCMonth() + 1)
    );
  }
  if (action === "nav" || action === "day" || action === "hr") {
    let header;
    if (id) {
      const r3 = await getReminder(env, chatId, id);
      if (!r3)
        return reply(NOT_FOUND);
      header = `📝 <b>${escapeHtml(r3.text)}</b>
Сейчас: ${formatTashkent(r3.event_at)}

`;
    } else {
      const state2 = await getState(env, chatId);
      if (!state2 || state2.edit_id)
        return reply("⚠️ Сессия устарела. Напишите название события заново.");
      header = `${state2.shared ? "👥 <i>Общее событие</i>\n" : ""}📝 <b>${escapeHtml(state2.text)}</b>

`;
    }
    if (action === "nav") {
      const [y2, m2] = args[1].split("-").map(Number);
      return reply(`${header}📅 Выберите дату:`, calendarKeyboard(y2, m2, id));
    }
    const date = args[1];
    if (date < todayStr())
      return;
    const [y, m, d] = date.split("-").map(Number);
    if (action === "day") {
      return reply(`${header}📅 ${pad(d)}.${pad(m)}.${y} (${weekdayOf(y, m, d)})
🕐 Выберите час (время Ташкента):`, hoursKeyboard(date, id));
    }
    const eventAt = tashkentToUtc(y, m, d, Number(args[2]), 0);
    if (eventAt <= Date.now()) {
      return reply(`${header}⚠️ Это время уже прошло. Выберите другое:`, hoursKeyboard(date, id));
    }
    if (id) {
      const r3 = await getReminder(env, chatId, id);
      await updateSchedule(env, r3, { eventAt });
      const updated = await getReminder(env, chatId, id);
      return reply(`✅ Дата изменена.

${card(updated)}

Что ещё изменить?`, editMenuKeyboard(env, chatId, updated));
    }
    const state = await getState(env, chatId);
    const shared = state.shared && isMember(env, chatId) ? 1 : 0;
    const now = Date.now();
    const res = await env.DB.prepare(
      "INSERT INTO reminders (chat_id, text, event_at, alerts, notified_until, next_at, shared) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(chatId, state.text, eventAt, joinAlerts(DEFAULT_ALERTS), now, computeNextAt(eventAt, DEFAULT_ALERTS, now), shared).run();
    await clearState(env, chatId);
    const r2 = await getReminder(env, chatId, res.meta.last_row_id);
    if (shared)
      await notifyOthers(env, chatId, `👥 ${userName(cq.from)} добавляет общее событие:

${card(r2)}`);
    return reply(`✅ Сохранено!

${card(r2)}`, {
      inline_keyboard: [[
        btn("🔔 Изменить предупреждения", `al:${r2.id}`),
        btn("✏️ Изменить", `ed:${r2.id}`)
      ]]
    });
  }
  const r = await getReminder(env, chatId, id);
  if (!r)
    return reply(NOT_FOUND);
  if (action === "ed") {
    await clearState(env, chatId);
    return reply(`${card(r)}

Что изменить?`, editMenuKeyboard(env, chatId, r));
  }
  if (action === "shr") {
    if (!isMember(env, chatId))
      return;
    if (r.shared) {
      await env.DB.prepare("UPDATE reminders SET shared = 0, chat_id = ? WHERE id = ?").bind(chatId, id).run();
      await notifyOthers(env, chatId, `👤 ${userName(cq.from)} делает событие личным (вы его больше не увидите):

📝 <b>${escapeHtml(r.text)}</b>`);
    } else {
      await env.DB.prepare("UPDATE reminders SET shared = 1 WHERE id = ?").bind(id).run();
    }
    const updated = await getReminder(env, chatId, id);
    if (updated.shared)
      await notifyOthers(env, chatId, `👥 ${userName(cq.from)} добавляет общее событие:

${card(updated)}`);
    return reply(
      `✅ Теперь событие ${updated.shared ? "общее" : "личное"}.

${card(updated)}

Что ещё изменить?`,
      editMenuKeyboard(env, chatId, updated)
    );
  }
  if (action === "ecal") {
    const now = tashkentNow();
    return reply(
      `📝 <b>${escapeHtml(r.text)}</b>
Сейчас: ${formatTashkent(r.event_at)}

📅 Выберите новую дату:`,
      calendarKeyboard(now.getUTCFullYear(), now.getUTCMonth() + 1, id)
    );
  }
  if (action === "alt") {
    const error = await toggleAlert(env, r, Number(args[1]));
    await tg(env, "answerCallbackQuery", {
      callback_query_id: cq.id,
      ...error && { text: error, show_alert: true }
    });
    if (error)
      return;
    return reply(alertsPrompt(r), alertsKeyboard(r));
  }
  if (action === "al") {
    await clearState(env, chatId);
    return reply(alertsPrompt(r), alertsKeyboard(r));
  }
  if (action === "alm") {
    if (activeAlerts(r).length >= MAX_ALERTS) {
      return reply(
        `⚠️ Уже ${MAX_ALERTS} предупреждений — это максимум. Сначала выключите одно.`,
        { inline_keyboard: [[btn("⬅️ Назад", `al:${id}`)]] }
      );
    }
    await setInputMode(env, chatId, id, "alert");
    return reply(
      `${card(r)}

✍️ Введите число — за сколько дней предупредить (1–${MAX_ALERT_DAYS}):`,
      { inline_keyboard: [[btn("⬅️ Назад", `al:${id}`)]] }
    );
  }
  if (action === "ren") {
    await setInputMode(env, chatId, id, "rename");
    return reply(
      `📝 Сейчас: <b>${escapeHtml(r.text)}</b>

✏️ Напишите новое название:`,
      { inline_keyboard: [[btn("⬅️ Назад", `ed:${id}`)]] }
    );
  }
  if (action === "dl") {
    const from = args[1] === "e" ? "e" : "l";
    return reply(`🗑 Удалить напоминание?

${card(r)}`, {
      inline_keyboard: [[
        btn("✅ Да, удалить", `dly:${id}:${from}`),
        btn("❌ Нет", from === "e" ? `ed:${id}` : "dlist")
      ]]
    });
  }
  if (action === "dly") {
    await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(id).run();
    if (r.shared)
      await notifyOthers(env, chatId, `🗑 ${userName(cq.from)} удаляет общее событие:

📝 <b>${escapeHtml(r.text)}</b>
📅 ${formatTashkent(r.event_at)}`);
    const { text, markup } = pickerMessage(await listReminders(env, chatId), args[1] === "e" ? "e" : "l");
    return reply(`✅ Удалено: <b>${escapeHtml(r.text)}</b>

${text}`, markup);
  }
}
async function processReminders(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT * FROM reminders WHERE next_at <= ?").bind(now).all();
  for (const r of results) {
    const text = escapeHtml(r.text);
    const when = formatTashkent(r.event_at);
    const alerts = parseAlerts(r.alerts);
    let message, sql;
    if (r.event_at <= now) {
      message = `🔔 <b>Сейчас:</b> ${text}
📅 ${when}`;
      sql = env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(r.id);
    } else {
      const due = alerts.filter((d2) => {
        const t = r.event_at - d2 * DAY;
        return t > r.notified_until && t <= now;
      });
      sql = env.DB.prepare("UPDATE reminders SET notified_until = ?, next_at = ? WHERE id = ?").bind(now, computeNextAt(r.event_at, alerts, now), r.id);
      if (!due.length) {
        await sql.run();
        continue;
      }
      const d = Math.min(...due);
      const label = d === 1 ? "Завтра" : d === 7 ? "Через неделю" : `Через ${d} ${ruDays(d)}`;
      message = `⏰ <b>${label}:</b> ${text}
📅 ${when}`;
    }
    if (r.shared)
      message += "\n👥 <i>Общее событие</i>";
    const members = sharedMembers(env);
    const recipients = r.shared && members.length ? members : [r.chat_id];
    const results2 = [];
    for (const to of recipients)
      results2.push(await send(env, to, message));
    if (results2.some((x) => x.ok)) {
      await sql.run();
    } else if (results2.every((x) => x.error_code === 403 || x.error_code === 400)) {
      await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(r.id).run();
    }
  }
}
function isAllowed(env, update) {
  const allowed = (env.ALLOWED_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length)
    return true;
  const from = update.message?.from || update.callback_query?.from;
  return from && allowed.includes(String(from.id));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/setup") {
      if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const hook = await tg(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"]
      });
      await tg(env, "setMyCommands", {
        commands: [
          { command: "list", description: "Мои напоминания" },
          { command: "edit", description: "Изменить напоминание" },
          { command: "delete", description: "Удалить напоминание" },
          { command: "help", description: "Помощь" }
        ]
      });
      return Response.json(hook);
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const update = await request.json();
        if (isAllowed(env, update)) {
          if (update.message)
            await handleMessage(env, update.message);
          else if (update.callback_query)
            await handleCallback(env, update.callback_query);
        }
      } catch (e) {
        console.log("Error:", e.stack || e);
      }
      return new Response("ok");
    }
    return new Response("Reminder bot is running");
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processReminders(env));
  }
};
