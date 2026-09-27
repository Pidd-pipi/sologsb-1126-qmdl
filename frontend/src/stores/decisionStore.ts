/**
 * 选址决定台账的本地读写。
 *
 * 关键约束：
 *  - 命中风险否决的营位不能推荐；推荐理由为空时提交失败（页面与 store 双重校验）。
 *  - 同一营位只有一份「生效中」推荐：确认新推荐时，在同一事务里把该营位
 *    旧的生效记录标为「已被替代」，再写入新记录。
 *  - 台账记录落库后不再修改快照：之后调权重或补录评估，名次重算，记录照旧。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { DecisionDraft, DecisionRecord } from '@/types/decision'
import { nextSerialNo, nowIso } from '@/utils/format'

export const useDecisionStore = defineStore('decision', () => {
  const list = ref<DecisionRecord[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.decisions.orderBy('id').toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function byId(id: number | null | undefined): DecisionRecord | null {
    if (id == null || Number.isNaN(id)) return null
    return list.value.find((d) => d.id === id) ?? null
  }

  /** 某营位当前生效中的推荐（没有则为 null） */
  function activeOf(siteId: number | null | undefined): DecisionRecord | null {
    if (siteId == null) return null
    return list.value.find((d) => d.siteId === siteId && d.status === 'active') ?? null
  }

  /** 某营位的全部决定记录（新的在前），详情页/台账展开用 */
  function historyOf(siteId: number | null | undefined): DecisionRecord[] {
    if (siteId == null) return []
    return list.value
      .filter((d) => d.siteId === siteId)
      .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
  }

  /** 生效中的推荐总数（头部统计用） */
  const activeCount = computed(() => list.value.filter((d) => d.status === 'active').length)

  /**
   * 确认推荐并留档。
   * 快照由调用方按当前评分结果组装；本函数负责校验硬约束、生成流水号，
   * 并在同一事务里完成「旧记录标替代 + 新记录生效」。
   */
  async function confirmDecision(input: DecisionDraft): Promise<number> {
    const reason = input.reason.trim()
    if (!reason) throw new Error('推荐理由不能为空')
    if (input.snapshot.vetoed) throw new Error('命中风险否决的营位不能推荐')

    const now = nowIso()
    const record = toPlain({
      ...input,
      reason,
      code: nextSerialNo('DC-', list.value.map((d) => d.code)),
      decidedAt: now,
      status: 'active' as const,
      supersededById: null,
      supersededAt: null,
      createdAt: now,
      updatedAt: now
    }) as DecisionRecord
    delete record.id

    const id = await db.transaction('rw', db.decisions, async () => {
      const newId = await db.decisions.add(record)
      // 同一营位只保留一份生效推荐：旧的生效记录标为已被替代
      await db.decisions
        .where('siteId')
        .equals(input.siteId)
        .and((d) => d.status === 'active' && d.id !== newId)
        .modify({
          status: 'superseded',
          supersededById: newId,
          supersededAt: now,
          updatedAt: now
        })
      return newId
    })
    await load()
    return id
  }

  return {
    list,
    loading,
    loaded,
    activeCount,
    load,
    byId,
    activeOf,
    historyOf,
    confirmDecision
  }
})
