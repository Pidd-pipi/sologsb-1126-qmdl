/**
 * 选址决定台账的本地读写。
 * 确认推荐时把得分、权重、等级、因子数值与风险状态整体留档；
 * 同一营位只保留一条「生效中」记录，改选时旧记录在同一事务里标为已被替代。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { DecisionRecord } from '@/types/decision'
import { nowIso, todayIso } from '@/utils/format'

export const useDecisionStore = defineStore('decision', () => {
  const list = ref<DecisionRecord[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.decisions.toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 某营位当前生效中的推荐（同一营位至多一条）。 */
  function activeOf(siteId: number | null | undefined): DecisionRecord | null {
    if (siteId == null) return null
    return list.value.find((d) => d.siteId === siteId && d.status === 'active') ?? null
  }

  /** 某营位的全部决定记录（新 → 旧），详情页复核用。 */
  function decisionsOf(siteId: number | null | undefined): DecisionRecord[] {
    if (siteId == null) return []
    return list.value
      .filter((d) => d.siteId === siteId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  /**
   * 确认推荐：新记录生效，同营位旧的生效记录在同一事务里标为已被替代。
   * 页面已做「理由非空 / 未命中否决」校验，这里再兜底一次，保证台账不写脏数据。
   */
  async function decide(input: DecisionRecord): Promise<number> {
    if (!input.reason.trim()) throw new Error('推荐理由不能为空')
    if (input.vetoed) throw new Error('命中风险否决的营位不能推荐')
    const now = nowIso()
    const record = toPlain({
      ...input,
      reason: input.reason.trim(),
      decidedBy: input.decidedBy.trim() || '未署名',
      decidedAt: input.decidedAt || todayIso(),
      status: 'active',
      supersededBy: null,
      supersededAt: null,
      createdAt: now,
      updatedAt: now
    }) as DecisionRecord
    delete record.id
    const id = await db.transaction('rw', db.decisions, async () => {
      const newId = await db.decisions.add(record)
      await db.decisions
        .where('siteId')
        .equals(input.siteId)
        .and((d) => d.status === 'active' && d.id !== newId)
        .modify({
          status: 'superseded',
          supersededBy: newId,
          supersededAt: now,
          updatedAt: now
        })
      return newId
    })
    await load()
    return id
  }

  /** 全部台账记录（新 → 旧），台账页直接消费。 */
  const ledger = computed<DecisionRecord[]>(() =>
    [...list.value].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  )

  /** 当前生效中的推荐数（头部统计用）。 */
  const activeCount = computed(() => list.value.filter((d) => d.status === 'active').length)

  return {
    list,
    loading,
    loaded,
    ledger,
    activeCount,
    load,
    activeOf,
    decisionsOf,
    decide
  }
})
