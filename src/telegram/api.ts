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
