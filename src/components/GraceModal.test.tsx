import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../loanDefaults'
import { createDefaultGraceRange } from './GraceModal'

describe('createDefaultGraceRange', () => {
  it('строит диапазон льготы от актуального графика, а не от фиксированного 2027 года', () => {
    const config = createDefaultConfig(new Date(2030, 6, 4))

    expect(createDefaultGraceRange(config, new Date(2030, 6, 4))).toEqual({
      startDate: '2030-08-15',
      endDate: '2030-10-15'
    })
  })
})
