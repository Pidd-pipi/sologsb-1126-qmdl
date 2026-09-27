/**
 * DecisionRecord（选址决定台账）—— 确认推荐那一刻的留档快照。
 *
 * 负责人确认推荐时，把当时的得分、名次、等级、权重方案、因子数值与风险状态
 * 整体抄进台账；之后调整权重方案或补录因子评估，当前名次会重算，
 * 但台账记录保持原样，便于追溯「先前为何推荐这个营位」。
 *
 * 同一营位同一时刻只有一份「生效中」的推荐；改选后新记录生效，
 * 旧记录自动标为「已被替代」并回写替代者 id 与替代时间。
 */
import type { FactorWeights, GradeThresholds, NormalizeMethod } from '@/types/score'
import type { Grade, RawFactorValues } from '@/utils/score'

/** 决定状态：active = 生效中，superseded = 已被替代 */
export type DecisionStatus = 'active' | 'superseded'

/** 确认推荐那一刻的评分留档（落库后不再随名次重算变化） */
export interface DecisionSnapshot {
  /** 留档时的综合得分 */
  total: number
  /** 留档时的名次（按当时全部营位降序） */
  rank: number
  /** 留档时的推荐等级 */
  grade: Grade
  /** 留档时采用的权重方案 id（临时权重为 null） */
  profileId: number | null
  /** 留档时的方案名称（冗余，方案改名/删除后仍可读） */
  profileName: string
  /** 留档时的归一化方式 */
  normalize: NormalizeMethod
  /** 留档时的各因子权重 */
  weights: FactorWeights
  /** 留档时的 A/B 等级阈值 */
  thresholds: GradeThresholds
  /** 留档时的因子原始数值 */
  raw: RawFactorValues
  /** 留档时是否命中风险否决（可推荐的营位必为 false） */
  vetoed: boolean
  /** 留档时命中的否决类型 */
  vetoTypes: string[]
}

export interface DecisionRecord {
  /** 主键，自增 */
  id?: number
  /** 台账流水号，如 DC-0001 */
  code: string
  /** 被推荐的营位 id */
  siteId: number
  /** 营位编号（冗余留档，营位改名/删除后台账仍可读） */
  siteCode: string
  /** 营位名称（冗余留档） */
  siteName: string
  /** 所属营地（冗余留档） */
  campName: string
  /** 推荐理由（必填，为空时提交失败） */
  reason: string
  /** 决定人 */
  decidedBy: string
  /** 确认时间（ISO） */
  decidedAt: string
  /** 生效中 / 已被替代 */
  status: DecisionStatus
  /** 替代本记录的新台账 id（status = superseded 时回填） */
  supersededById: number | null
  /** 被替代时间（ISO） */
  supersededAt: string | null
  /** 评分留档快照 */
  snapshot: DecisionSnapshot
  createdAt: string
  updatedAt: string
}

/** 确认推荐时由页面组装的入参；编号、状态与时间由 store 统一填写 */
export type DecisionDraft = Omit<
  DecisionRecord,
  'id' | 'code' | 'status' | 'supersededById' | 'supersededAt' | 'decidedAt' | 'createdAt' | 'updatedAt'
>

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  active: '生效中',
  superseded: '已被替代'
}
