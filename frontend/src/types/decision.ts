/**
 * DecisionRecord（选址决定）—— 一次「确认推荐」的留档快照。
 * 确认当下的得分、名次、权重、等级、因子数值与风险状态全部冻结存档；
 * 之后调整权重方案或补录因子评估只会重算当前名次，不回写历史决定。
 * 同一营位同一时刻只有一条「生效中」记录，改选后旧记录自动标为「已被替代」。
 */
import type { FactorWeights, GradeThresholds, NormalizeMethod } from '@/types/score'
import type { Grade, RawFactorValues } from '@/utils/score'

/** 决定状态：生效中 / 已被替代 */
export type DecisionStatus = 'active' | 'superseded'

export interface DecisionRecord {
  /** 主键，自增 */
  id?: number
  /** 被推荐的营位 id */
  siteId: number
  /** 推荐理由（必填，空理由提交失败） */
  reason: string
  /** 决定人 */
  decidedBy: string
  /** 决定日期（YYYY-MM-DD） */
  decidedAt: string
  /** 状态：生效中 / 已被替代 */
  status: DecisionStatus
  /** 替代本条记录的新决定 id（仅已被替代时有值） */
  supersededBy: number | null
  /** 被替代时间（ISO） */
  supersededAt: string | null

  /* ---- 以下均为确认当下的留档快照，之后重算不回写 ---- */
  /** 营位编号快照 */
  siteCode: string
  /** 营位名称快照 */
  siteName: string
  /** 所属营地快照 */
  campName: string
  /** 综合得分快照 */
  score: number
  /** 名次快照（确认当下在全部营位中的排名） */
  rank: number
  /** 等级快照 */
  grade: Grade
  /** 所用权重方案 id / 名称快照 */
  profileId: number | null
  profileName: string
  /** 归一化方式快照 */
  normalize: NormalizeMethod
  /** 各因子权重快照 */
  weights: FactorWeights
  /** 等级阈值快照 */
  thresholds: GradeThresholds
  /** 因子原始数值快照 */
  factors: RawFactorValues
  /** 风险状态快照：确认时是否命中否决（命中否决的营位不允许推荐，故正常为 false） */
  vetoed: boolean
  /** 风险状态快照：确认时命中的否决类型 */
  vetoTypes: string[]
  createdAt: string
  updatedAt: string
}

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  active: '生效中',
  superseded: '已被替代'
}
