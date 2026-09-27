<script setup lang="ts">
/**
 * `/decisions` 选址决定台账 —— 选定营位、填写理由并确认推荐，
 * 把确认当下的得分、权重、等级、因子数值与风险状态冻结留档。
 * 之后调整权重或补录评估只会重算当前名次，台账记录照旧；
 * 同一营位只有一条生效推荐，改选后旧记录自动标为已被替代。
 * 命中风险否决的营位不能推荐，理由为空时提交失败。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useDecisionStore } from '@/stores/decisionStore'
import { useRanking } from '@/hooks/useRanking'
import { FACTOR_META, NORMALIZE_LABELS } from '@/types/score'
import type { DecisionRecord } from '@/types/decision'
import { DECISION_STATUS_LABELS } from '@/types/decision'
import type { FactorKey, NormalizeMethod } from '@/types/score'
import { formatDate, formatDateTime, formatFactorValue, formatScore, todayIso } from '@/utils/format'
import { weightSum } from '@/utils/score'

const route = useRoute()
const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()
const decisionStore = useDecisionStore()

/** 当前名次（全量营位，不套筛选），既给预览也给台账的「当前对照」列 */
const { scoreOf } = useRanking({
  sites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds
})

const form = reactive({
  siteId: null as number | null,
  reason: '',
  decidedBy: '',
  decidedAt: todayIso()
})

const submitting = ref(false)

/** 营位选项：命中否决的置灰不可选 */
const siteOptions = computed(() =>
  siteStore.list
    .filter((s): s is typeof s & { id: number } => typeof s.id === 'number')
    .map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.name}（${s.campName}）`,
      vetoed: uiStore.isVetoed(s.id)
    }))
)

const selectedRow = computed(() => (form.siteId == null ? null : scoreOf(form.siteId)))
const selectedVetos = computed(() => uiStore.vetosOf(form.siteId))
const selectedVetoed = computed(() => selectedVetos.value.length > 0)
/** 该营位当前生效中的推荐（改选时提示会被替代） */
const selectedActive = computed(() => decisionStore.activeOf(form.siteId))

const activeProfile = computed(() => profileStore.activeProfile)

/** 预览用：选中营位当前的因子数值（即将要留档的内容） */
const previewFactors = computed(() => {
  const row = selectedRow.value
  if (!row) return []
  return FACTOR_META.map((m) => ({
    key: m.key,
    label: m.label,
    text: formatFactorValue(m.key, row.raw[m.key])
  }))
})

/** 归一方式文案（模板里 row 为 any，统一走这里避免索引报错） */
function normalizeLabel(method: NormalizeMethod): string {
  return NORMALIZE_LABELS[method] ?? method
}

/** 台账展开行：因子数值快照 */
function factorSnapshot(record: DecisionRecord): Array<{ key: FactorKey; label: string; text: string }> {
  return FACTOR_META.map((m) => ({
    key: m.key,
    label: m.label,
    text: formatFactorValue(m.key, record.factors[m.key])
  }))
}

/** 台账展开行：权重快照 */
function weightSnapshot(record: DecisionRecord): Array<{ key: FactorKey; label: string; weight: number }> {
  return FACTOR_META.map((m) => ({
    key: m.key,
    label: m.label,
    weight: record.weights[m.key] ?? 0
  }))
}

/** 台账行的当前对照：营位可能已被删除 */
function liveOf(record: DecisionRecord) {
  const site = siteStore.byId(record.siteId)
  if (!site) return { deleted: true, row: null, vetoed: false }
  return { deleted: false, row: scoreOf(record.siteId), vetoed: uiStore.isVetoed(record.siteId) }
}

async function submit(): Promise<void> {
  if (form.siteId == null) {
    ElMessage.warning('请选择要推荐的营位')
    return
  }
  const reason = form.reason.trim()
  if (!reason) {
    ElMessage.warning('推荐理由不能为空，请填写后再提交')
    return
  }
  const site = siteStore.byId(form.siteId)
  const row = scoreOf(form.siteId)
  if (!site || !row) {
    ElMessage.error('营位数据异常，无法留档')
    return
  }
  if (row.vetoed) {
    ElMessage.error('该营位命中风险否决项，不能推荐')
    return
  }
  submitting.value = true
  try {
    const profile = activeProfile.value
    const replaced = selectedActive.value
    await decisionStore.decide({
      siteId: form.siteId,
      reason,
      decidedBy: form.decidedBy,
      decidedAt: form.decidedAt || todayIso(),
      status: 'active',
      supersededBy: null,
      supersededAt: null,
      siteCode: site.code,
      siteName: site.name,
      campName: site.campName,
      score: row.total,
      rank: row.rank,
      grade: row.grade,
      profileId: typeof profile?.id === 'number' ? profile.id : null,
      profileName: profile?.name ?? '未命名方案',
      normalize: profile?.normalize ?? 'minmax',
      weights: { ...profileStore.activeWeights },
      thresholds: { ...(profile?.thresholds ?? { gradeA: 78, gradeB: 58 }) },
      factors: { ...row.raw },
      vetoed: row.vetoed,
      vetoTypes: selectedVetos.value.map((v) => v.type),
      createdAt: '',
      updatedAt: ''
    })
    ElMessage.success(
      replaced
        ? `已确认推荐并留档，原记录 #${replaced.id} 标为已被替代`
        : '已确认推荐并留档：得分、权重、等级、因子与风险状态已冻结存档'
    )
    form.reason = ''
  } catch (err) {
    ElMessage.error(`提交失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

/** 从名次表 / 详情页带参跳入时预选中营位；深链刷新时等营位数据加载完再套用 */
watch(
  () => [route.query.site, siteStore.loaded] as const,
  () => {
    const id = Number(route.query.site)
    if (Number.isInteger(id) && id > 0 && siteStore.byId(id)) {
      form.siteId = id
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>选址决定台账</h1>
        <p>
          选定营位、填写理由并确认推荐，确认当下的得分、权重、等级、因子数值与风险状态会整体留档。
          之后调整权重方案或补录评估只会重算当前名次，台账里的决定照旧可查。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/')">返回名次表</el-button>
        <el-button @click="router.push('/scoring')">调权重</el-button>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="同一营位只有一份生效推荐"
      description="对同一营位再次确认推荐时，新记录生效，旧记录自动标为「已被替代」并保留在台账中；命中风险否决项的营位不能推荐，理由为空无法提交。"
    />

    <div class="decision-layout">
      <section class="panel">
        <div class="panel__head">
          <h2>确认推荐</h2>
          <span class="weight-note">提交即留档，快照不回写</span>
        </div>
        <el-form label-width="100px" @submit.prevent>
          <el-form-item label="营位">
            <el-select
              id="decision-site"
              v-model="form.siteId"
              placeholder="选择要推荐的营位"
              filterable
              style="width: 100%"
            >
              <el-option
                v-for="opt in siteOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
                :disabled="opt.vetoed"
              >
                <span>{{ opt.label }}</span>
                <el-tag v-if="opt.vetoed" type="danger" size="small" style="float: right">
                  命中否决
                </el-tag>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="决定人">
            <el-input id="decision-by" v-model="form.decidedBy" placeholder="如 李营" />
          </el-form-item>
          <el-form-item label="决定日期">
            <el-date-picker
              id="decision-date"
              v-model="form.decidedAt"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="推荐理由">
            <el-input
              id="decision-reason"
              v-model="form.reason"
              type="textarea"
              :rows="3"
              placeholder="必填：为什么在当前名次下推荐这个营位（留档后随时可查）"
            />
          </el-form-item>
          <el-form-item>
            <el-button
              id="decision-submit"
              type="primary"
              :loading="submitting"
              :disabled="form.siteId == null || selectedVetoed"
              @click="submit"
            >
              确认推荐并留档
            </el-button>
            <el-button
              @click="
                () => {
                  form.siteId = null
                  form.reason = ''
                  form.decidedBy = ''
                }
              "
            >
              清空
            </el-button>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="selectedVetoed"
          type="error"
          :closable="false"
          show-icon
          title="该营位命中风险否决项，不能推荐"
          :description="selectedVetos.map((v) => `${v.type}：${v.description}`).join(' ｜ ')"
        />
        <el-alert
          v-else-if="selectedActive"
          type="warning"
          :closable="false"
          show-icon
          :title="`该营位已有生效中的推荐（记录 #${selectedActive.id}）`"
          description="再次提交后新记录生效，原记录自动标为「已被替代」，两份都保留在台账中。"
        />
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>留档内容预览</h2>
          <GradeBadge
            v-if="selectedRow"
            :grade="selectedRow.grade"
            :score="selectedRow.total"
            :vetoed="selectedVetoed"
          />
        </div>
        <template v-if="selectedRow">
          <div class="preview-list">
            <div class="preview-item">
              <span>综合得分 / 名次</span>
              <strong>{{ formatScore(selectedRow.total) }} 分 · 第 {{ selectedRow.rank }} 名</strong>
            </div>
            <div class="preview-item">
              <span>权重方案</span>
              <strong>
                {{ activeProfile?.name ?? '—' }} ·
                {{ activeProfile ? NORMALIZE_LABELS[activeProfile.normalize] : '—' }} · 权重合计
                {{ weightSum(profileStore.activeWeights) }}
              </strong>
            </div>
            <div class="preview-item">
              <span>等级阈值</span>
              <strong>
                A ≥ {{ activeProfile?.thresholds.gradeA ?? 78 }} / B ≥ {{ activeProfile?.thresholds.gradeB ?? 58 }}
              </strong>
            </div>
            <div class="preview-item">
              <span>风险状态</span>
              <strong v-if="selectedVetoed" class="danger-text">
                命中否决：{{ selectedVetos.map((v) => v.type).join('、') }}
              </strong>
              <strong v-else>无否决，可推荐</strong>
            </div>
          </div>
          <el-divider content-position="left">因子数值（随决定一并留档）</el-divider>
          <div class="factor-snapshot">
            <div v-for="f in previewFactors" :key="f.key" class="factor-snapshot__item">
              <span>{{ f.label }}</span>
              <strong>{{ f.text }}</strong>
            </div>
          </div>
        </template>
        <p v-else class="panel__hint">
          请先从左侧选择营位。提交前可在此核对将要留档的得分、权重、等级、因子数值与风险状态。
        </p>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>决定台账</h2>
        <span class="weight-note">
          共 {{ decisionStore.ledger.length }} 条 · 生效中 {{ decisionStore.activeCount }} 条
        </span>
      </div>
      <el-table
        v-if="decisionStore.ledger.length"
        data-testid="decision-table"
        :data="decisionStore.ledger"
        size="small"
        border
        stripe
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="snapshot">
              <div class="snapshot__block">
                <h4>因子数值快照</h4>
                <div class="factor-snapshot">
                  <div v-for="f in factorSnapshot(row)" :key="f.key" class="factor-snapshot__item">
                    <span>{{ f.label }}</span>
                    <strong>{{ f.text }}</strong>
                  </div>
                </div>
              </div>
              <div class="snapshot__block">
                <h4>权重快照（合计 {{ weightSum(row.weights) }}）</h4>
                <div class="factor-snapshot">
                  <div v-for="w in weightSnapshot(row)" :key="w.key" class="factor-snapshot__item">
                    <span>{{ w.label }}</span>
                    <strong>{{ w.weight }}</strong>
                  </div>
                </div>
              </div>
              <div class="snapshot__block snapshot__meta">
                <span>
                  留档方案：{{ row.profileName }} · {{ normalizeLabel(row.normalize) }} · 阈值 A ≥
                  {{ row.thresholds.gradeA }} / B ≥ {{ row.thresholds.gradeB }}
                </span>
                <span>
                  风险状态快照：
                  <template v-if="row.vetoed">命中否决（{{ row.vetoTypes.join('、') }}）</template>
                  <template v-else>无否决</template>
                </span>
                <span v-if="row.status === 'superseded'" class="danger-text">
                  已被记录 #{{ row.supersededBy }} 替代（{{ formatDateTime(row.supersededAt ?? '') }}）
                </span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ DECISION_STATUS_LABELS[row.status as DecisionRecord['status']] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="营位" min-width="190">
          <template #default="{ row }">
            <el-link
              v-if="siteStore.byId(row.siteId)"
              type="primary"
              underline="never"
              @click="router.push(`/sites/${row.siteId}`)"
            >
              {{ row.siteCode }} · {{ row.siteName }}
            </el-link>
            <span v-else>{{ row.siteCode }} · {{ row.siteName }}（已删除）</span>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="留档得分 / 等级" width="190">
          <template #default="{ row }">
            <GradeBadge :grade="row.grade" :score="row.score" size="small" :vetoed="row.vetoed" />
          </template>
        </el-table-column>
        <el-table-column label="留档名次" width="92" align="center">
          <template #default="{ row }">第 {{ row.rank }} 名</template>
        </el-table-column>
        <el-table-column label="方案快照" min-width="150">
          <template #default="{ row }">
            {{ row.profileName }}
            <div class="cell-sub">{{ normalizeLabel(row.normalize) }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="推荐理由" min-width="220" show-overflow-tooltip />
        <el-table-column label="决定人 / 日期" width="130">
          <template #default="{ row }">
            {{ row.decidedBy }}
            <div class="cell-sub">{{ formatDate(row.decidedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前对照" min-width="150">
          <template #default="{ row }">
            <template v-if="!liveOf(row).deleted">
              <span>
                现第 {{ liveOf(row).row?.rank ?? '—' }} 名 ·
                {{ formatScore(liveOf(row).row?.total ?? 0) }} 分
              </span>
              <el-tag v-if="liveOf(row).vetoed" type="danger" size="small" class="ml6">现已否决</el-tag>
            </template>
            <span v-else class="muted">营位已删除</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">
        台账还是空的。在左侧选定营位、填写理由并确认推荐后，这里会留下可回溯的决定记录。
      </p>
    </section>
  </div>
</template>

<style scoped>
.decision-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1080px) {
  .decision-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  font-size: 13px;
  background: var(--gb-surface);
  border-radius: 8px;
}
.preview-item span {
  color: var(--gb-muted);
  white-space: nowrap;
}
.factor-snapshot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
}
.factor-snapshot__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  background: var(--gb-surface);
  border-radius: 8px;
  font-size: 12px;
}
.factor-snapshot__item span {
  color: var(--gb-muted);
}
.snapshot {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 16px;
}
.snapshot__block h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.snapshot__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--gb-muted);
}
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.danger-text {
  color: var(--gb-danger);
}
.ml6 {
  margin-left: 6px;
}
</style>
