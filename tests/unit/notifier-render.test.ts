import { beforeEach, describe, expect, it, vi } from 'vitest'
import { escapeHtml, plainText, renderMessage } from '@/modules/notifier/render'
import { resolveGroups, resolveMentions, resolvePublicUrl } from '@/modules/notifier/recipients'
import type { MentionRecipients, NotificationPayload } from '@/modules/notifier/types'
import type { Db } from '@/lib/db'
import { at } from '@/modules/events/fixture'

const config = vi.hoisted(() => ({ APP_BASE_URL: 'https://lancara.example/' }))
vi.mock('@/lib/env', () => ({ env: () => config }))

function payload(): NotificationPayload {
  return { schema_version: 1, kind: 'schedule.version.committed', idempotency_key: 'notify:event:v2', correlation_id: 'correlation',
    event: { id: 'event', name: 'Demo <script> & "acara"', timezone: 'Asia/Jakarta', curfew_at: at('21:00') },
    version: 2, base_version: 1, origin: 'manual_edit', committed_at: at('18:40'), actor: { actor_id: 'rina', display_name: 'Rina' },
    changes: [], items_changed: 0, projected_finish_at: at('20:45'),
    impact: [{ role_id: 'audio', role_label: 'PIC Audio', level: 'ACTION_REQUIRED', entries: [] },
      { role_id: 'lo', role_label: 'LO Talent', level: 'FYI', entries: [] },
      { role_id: 'stage', role_label: 'Stage Crew', level: 'ACTION_REQUIRED', entries: [] },
      { role_id: 'led', role_label: 'PIC LED', level: 'UNCHANGED', entries: [] },
      { role_id: 'mc', role_label: 'MC', level: 'BLOCKER', entries: [] }],
    roles: [{ id: 'audio', label: 'PIC Audio' }, { id: 'lo', label: 'LO Talent' }, { id: 'stage', label: 'Stage Crew' }],
  }
}

const recipients: MentionRecipients = { mentions: [{ telegram_user_id: '9007199254740993', display_name: 'Bayu & "Audio"', role_labels: ['PIC Audio'] }], unlinked_roles: ['LO Talent'], additional_count: 0 }
const fakeDb = (rows: unknown[]) => ({ query: vi.fn().mockResolvedValue({ rows }) }) as unknown as Db
beforeEach(() => { config.APP_BASE_URL = 'https://lancara.example/' })

describe('notifier Telegram HTML renderer', () => {
  it('escapes all dynamic text and preserves bigint Telegram IDs', () => {
    const message = renderMessage({ payload: payload(), paragraph: 'Talent <B> & "Panel" berubah.', recipients, publicUrl: `https://lancara.example/share/${'A'.repeat(32)}` })
    expect(message).toContain('<b>Rundown v2 · Demo &lt;script&gt; &amp; &quot;acara&quot;</b>')
    expect(message).toContain('Talent &lt;B&gt; &amp; &quot;Panel&quot; berubah.')
    expect(message).toContain('<a href="tg://user?id=9007199254740993">Bayu &amp; &quot;Audio&quot;</a> (PIC Audio)')
    expect(message).toContain('LO Talent (belum terhubung)')
    expect(message).toContain('>Lihat rundown</a>')
    expect(message).not.toContain('<script>')
  })
  it('marks a retry and omits public link unless passed an active share URL', () => {
    const result = renderMessage({ payload: payload(), paragraph: 'Jadwal berubah.', recipients, retry: true })
    expect(result).toContain('</b> (kirim ulang)')
    expect(result).not.toContain('Lihat rundown')
    for (const publicUrl of ['javascript:alert(1)', 'https://user:secret@lancara.example/share/' + 'A'.repeat(32), 'https://lancara.example/settings', 'https://lancara.example/share/invalid']) {
      expect(renderMessage({ payload: payload(), paragraph: 'Jadwal berubah.', recipients, publicUrl })).not.toContain('Lihat rundown')
    }
  })
  it('caps distinct mentions at twenty and shows the remainder', () => {
    const people = Array.from({ length: 23 }, (_, i) => ({ telegram_user_id: `${100 + i}`, display_name: `PIC ${i}`, role_labels: ['Audio'] }))
    const message = renderMessage({ payload: payload(), paragraph: 'Jadwal berubah.', recipients: { mentions: people, unlinked_roles: [], additional_count: 4 } })
    expect([...message.matchAll(/tg:\/\/user\?id=/g)]).toHaveLength(20)
    expect(message).toContain('+7 lainnya')
  })
  it('does not accept crafted identity hrefs or duplicate mentions', () => {
    const message = renderMessage({ payload: payload(), paragraph: '@everyone cek rundown.', recipients: {
      mentions: [...recipients.mentions, ...recipients.mentions, { telegram_user_id: '1" onclick="x', display_name: 'X', role_labels: [] }],
      unlinked_roles: [], additional_count: 0,
    } })
    expect([...message.matchAll(/tg:\/\/user\?id=/g)]).toHaveLength(1)
    expect(message).not.toContain('onclick')
    expect(message).not.toContain('@everyone')
  })
  it('neutralizes unsolicited URLs in source text and preserves the real share link in plain fallback', () => {
    const p = payload(); p.event.name = 'Acara https://untrusted.example'
    const publicUrl = `https://lancara.example/share/${'A'.repeat(32)}`
    const message = renderMessage({ payload: p, paragraph: 'Jadwal berubah.', recipients, publicUrl })
    expect(message).not.toContain('https://untrusted.example')
    expect(plainText(message)).toContain(`Lihat rundown: ${publicUrl}`)
  })
  it('fits <=4096 raw and parsed characters while preserving entities and all HTML tags', () => {
    const p = payload(); p.event.name = '<"&😀>'.repeat(300)
    const people = Array.from({ length: 25 }, (_, i) => ({ telegram_user_id: `${100 + i}`, display_name: '😀<&"'.repeat(100), role_labels: ['<&"'.repeat(100)] }))
    const message = renderMessage({ payload: p, paragraph: '<"&😀>'.repeat(1000), recipients: { mentions: people, unlinked_roles: ['&'.repeat(1000)], additional_count: 0 }, publicUrl: `https://lancara.example/share/${'A'.repeat(32)}` })
    expect(message.length).toBeLessThanOrEqual(4096)
    expect(plainText(message).length).toBeLessThanOrEqual(4096)
    expect((message.match(/<a /g) ?? []).length).toBe((message.match(/<\/a>/g) ?? []).length)
    expect(message.replace(/&(amp|lt|gt|quot);/g, '')).not.toContain('&')
    expect(message).not.toMatch(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/)
    expect(message).toContain('lainnya')
  })
  it('plain-text fallback has labels and no HTML entities/mention links', () => {
    const message = renderMessage({ payload: payload(), paragraph: 'Talent <B> & Panel berubah.', recipients })
    expect(plainText(message)).toContain('Demo <script> & "acara"')
    expect(plainText(message)).toContain('Bayu & "Audio" (PIC Audio)')
    expect(plainText(message)).not.toContain('tg://')
    expect(plainText(message)).not.toContain('&amp;')
    expect(plainText('<b>&amp;lt;</b>')).toBe('&lt;')
    expect(escapeHtml('<>&"')).toBe('&lt;&gt;&amp;&quot;')
  })
})

describe('notifier recipient resolution', () => {
  it('selects only approved groups for the specified event', async () => {
    const group = { id: 'group', event_id: 'event', chat_id: '-1009007199254740993', status: 'approved' }
    const db = fakeDb([group])
    expect(await resolveGroups('event', db)).toEqual([group])
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"), ['event'])
    expect(vi.mocked(db.query).mock.calls[0][0]).toContain('chat_id::text')
  })
  it('resolves ACTION_REQUIRED and FYI only, dedupes accounts, and labels unlinked roles', async () => {
    const db = fakeDb([
      { role_id: 'audio', telegram_user_id: '9007199254740993', display_name: 'Bayu' },
      { role_id: 'stage', telegram_user_id: '9007199254740993', display_name: 'Bayu' },
      { role_id: 'led', telegram_user_id: '99', display_name: 'not affected' },
    ])
    expect(await resolveMentions(payload(), db)).toEqual({ mentions: [{ telegram_user_id: '9007199254740993', display_name: 'Bayu', role_labels: ['PIC Audio', 'Stage Crew'] }],
      unlinked_roles: ['LO Talent'], additional_count: 0 })
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('JOIN telegram_accounts'), ['event', ['audio', 'lo', 'stage']])
  })
  it('caps mentions in resolution and includes overflow count', async () => {
    const db = fakeDb(Array.from({ length: 22 }, (_, i) => ({ role_id: 'audio', telegram_user_id: `${100 + i}`, display_name: `PIC ${i}` })))
    const result = await resolveMentions(payload(), db)
    expect(result.mentions).toHaveLength(20); expect(result.additional_count).toBe(2)
    expect(result.unlinked_roles).toEqual(['LO Talent', 'Stage Crew'])
  })
  it('does not query the DB when there are no affected roles', async () => {
    const p = payload(); p.impact = []; const db = fakeDb([])
    expect(await resolveMentions(p, db)).toEqual({ mentions: [], unlinked_roles: [], additional_count: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })
  it('requires valid APP_BASE_URL and an active same-event public share', async () => {
    const token = 'A'.repeat(32); const db = fakeDb([{ token }])
    expect(await resolvePublicUrl('event', db)).toBe(`https://lancara.example/share/${token}`)
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('revoked_at IS NULL'), ['event'])
    expect(await resolvePublicUrl('event', fakeDb([]))).toBeUndefined()
    expect(await resolvePublicUrl('event', fakeDb([{ token: 'invalid' }]))).toBeUndefined()
    for (const value of ['', 'javascript:alert(1)', 'https://user:secret@lancara.example', 'https://lancara.example?token=secret']) {
      config.APP_BASE_URL = value
      const noDb = fakeDb([{ token }])
      expect(await resolvePublicUrl('event', noDb)).toBeUndefined()
      expect(noDb.query).not.toHaveBeenCalled()
    }
  })
})
