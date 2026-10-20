import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  handle: vi.fn((channel: string, action: (event: unknown, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, action)
  }),
  on: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, on: mocks.on },
  dialog: { showOpenDialog: mocks.showOpenDialog }
}))

import { registerIpc } from '../../src/main/ipc/register'

describe('registerIpc', () => {
  it('passes the resolved restore candidate to the renderer', async () => {
    const candidate = {
      candidateId: 'candidate-id',
      storeName: '検査店舗',
      createdAt: '2026-10-20T00:00:00.000Z',
      schemaVersion: 7,
      userCount: 1,
      productCount: 2
    }
    const maintenance = {
      readSettings: vi.fn(),
      inspectRestoreCandidate: vi.fn().mockResolvedValue(candidate)
    }
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['backup.sqlite3'] })

    const senderFrame = { url: 'http://127.0.0.1:5173/' }
    const sender = { id: 1, mainFrame: senderFrame }
    const event = { sender, senderFrame }
    registerIpc({} as never, {} as never, {} as never, () => sender as never, () => true, maintenance as never, {} as never, () => null, () => undefined)

    const handler = mocks.handlers.get('data:inspectRestore')
    expect(handler).toBeDefined()
    const result = await handler!(event, 'session-token') as { ok: boolean; value: unknown }

    expect(result).toEqual({ ok: true, value: { cancelled: false, candidate } })
    expect(maintenance.readSettings).toHaveBeenCalledWith('session-token', 1)
    expect(maintenance.inspectRestoreCandidate).toHaveBeenCalledWith('session-token', 1, 'backup.sqlite3')
  })
})
