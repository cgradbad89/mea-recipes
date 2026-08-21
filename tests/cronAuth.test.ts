import { afterEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/cron/sync-nutrition/route'

const originalCronSecret = process.env.CRON_SECRET

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe('nutrition sync cron authentication', () => {
  it('fails closed when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(new Request('https://example.test/api/cron/sync-nutrition', {
      headers: { Authorization: 'Bearer undefined' },
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
