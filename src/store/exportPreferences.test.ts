import { describe, expect, it } from 'vitest'
import { useProjectStore } from './project'

describe('export preferences', () => {
  it('keeps the canvas dimensions authoritative by default', () => {
    expect(useProjectStore.getState().matchSource).toBe(false)
  })
})
