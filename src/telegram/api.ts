// Minimal Telegram Bot API client (fetch-based, works on Cloudflare Workers)

const API_BASE = 'https://api.telegram.org'

export async function tgCall(token: string, method: string, payload: Record<string, unknown>): Promise<any> {
  if (!token) return null
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await res.json()
  } catch (err) {
    console.error('Telegram API error:', err)
    return null
  }
}

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

export async function setWebhook(token: string, url: string): Promise<any> {
  return tgCall(token, 'setWebhook', { url })
}

export async function deleteWebhook(token: string): Promise<any> {
  return tgCall(token, 'deleteWebhook', {})
}

export async function getWebhookInfo(token: string): Promise<any> {
  return tgCall(token, 'getWebhookInfo', {})
}

/** Registers the "☰ Menu" command list shown next to the message box in Telegram clients. */
export async function setMyCommands(token: string, commands: { command: string; description: string }[]): Promise<any> {
  return tgCall(token, 'setMyCommands', { commands })
}

/**
 * Checks whether a user is a member of a chat/channel. Requires the bot to
 * be a member (ideally admin) of that chat — see requirement #6 (forced
 * channel join). Returns null on any API error (e.g. bot not in the channel
 * yet), which callers should treat as "can't verify" rather than "not a member".
 */
export async function getChatMember(token: string, chatId: string, userId: string | number): Promise<any> {
  const res = await tgCall(token, 'getChatMember', { chat_id: chatId, user_id: userId })
  if (!res || !res.ok) return null
  return res.result
}

/**
 * Sends the same message to many chats — used by the admin's manual
 * /broadcast command and by the automatic weekly "servers updated" notice
 * (see src/cron/tasks.ts). Telegram's bot API allows roughly 30
 * messages/second overall (and no more than ~1/second to the SAME chat,
 * which isn't a concern here since every chatId is different), so this
 * sends in small batches with a pause between them rather than firing every
 * message at once, which Telegram would start rate-limiting (429) partway
 * through a large user list.
 */
export async function broadcastToAll(
  token: string,
  chatIds: (string | number)[],
  text: string,
  extra: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number }> {
  const BATCH_SIZE = 20
  const PAUSE_MS = 1000
  let sent = 0
  let failed = 0
  for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map((id) => sendMessage(token, id, text, extra)))
    for (const r of results) {
      if (r && r.ok) sent++
      else failed++
    }
    if (i + BATCH_SIZE < chatIds.length) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
  }
  return { sent, failed }
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<any> {
  return tgCall(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert })
}
