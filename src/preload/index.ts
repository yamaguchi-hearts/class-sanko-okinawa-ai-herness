// Main/Preload/Renderer境界を確立する段階。公開IPC APIはPhase 1で用途別に追加する。
import { contextBridge } from 'electron'
import type { Phase0Status } from '../shared/contracts'

const status: Phase0Status = Object.freeze({ ready: true })
contextBridge.exposeInMainWorld('appStatus', status)
