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

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<any> {
  return tgCall(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert })
}
