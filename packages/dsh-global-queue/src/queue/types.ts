export type QueueStatus = 'queued' | 'running' | 'done' | 'interrupted'
export type QueueItemStats = { tokens: number }
export type QueueItem = {
  id: string
  text: string
  workspacePath: string
  targetSessionId: string | null
  status: QueueStatus
  agentPreset?: string
  sessionId?: string
  stats?: QueueItemStats
  startedAt?: number
  endedAt?: number
  createdAt: number
  updatedAt: number
}
