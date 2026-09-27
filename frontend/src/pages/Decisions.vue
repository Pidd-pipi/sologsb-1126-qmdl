<script setup lang="ts">
/**
 * `/decisions` 选址决定台账 —— 选定营位、填写理由并确认推荐。
 *
 * 确认那一刻的综合得分、名次、等级、权重方案、因子数值与风险状态整体留档；
 * 之后调整权重方案或补录因子评估，当前名次会重算，但台账记录保持原样。
 * 同一营位只有一份「生效中」推荐，改选后旧记录自动标为「已被替代」；
 * 命中风险否决的营位不能推荐，理由为空时提交失败。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useDecisionStore } from '@/stores/decisionStore'
import { useRanking } from '@/hooks/useRanking'
import { DECISION_STATUS_LABELS } from '@/types/decision'
import { FACTOR_META, NORMALIZE_LABELS } from '@/types/score'
import type { NormalizeMethod } from '@/types/score'
import { formatDateTime, formatFactorValue, formatScore } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()
const decisionStore = useDecisionStore()

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
  decidedBy: ''
})

const submitting = ref(false)

/** 从名次表带 ?site=<id> 跳转过来时预选营位；数据加载完成后校验有效性 */
watch(
  () => siteStore.loaded,
  (loaded) => {
    if (!loaded) return
    const q = Number(route.query.site)
    if (Number.isInteger(q) && siteStore.byId(q)) form.siteId = q
  },
  { immediate: true }
)

const siteOptions = computed(() =>
  siteStore.list
    .filter((s): s is typeof s & { id: number } => typeof s.id === 'number')
    .map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.name}（${s.campName}）`,
      vetoed: uiStore.isVetoed(s.id),
      recommended: decisionStore.activeOf(s.id) != null
    }))
)

const selectedSite = computed(() => (form.siteId == null ? null : siteStore.byId(form.siteId)))
const selectedRow = computed(() => (form.siteId == null ? null : scoreOf(form.siteId)))
const selectedVetos = computed(() => uiStore.vetosOf(form.siteId))
const selectedVetoed = computed(() => selectedVetos.value.length > 0)
/** 该营位当前生效中的推荐（再次确认将替代它） */
const activeOfSelected = computed(() =>
  form.siteId == null ? null : decisionStore.activeOf(form.siteId)
)

const activeProfileName = computed(() => profileStore.activeProfile?.name ?? '临时权重')
const activeNormalize = computed(() =>
  profileStore.activeProfile ? NORMALIZE_LABELS[profileStore.activeProfile.normalize] : '极差归一'
)

async function submit(): Promise<void> {
  if (form.siteId == null) {
    ElMessage.warning('请选择要推荐的营位')
    return
  }
  if (selectedVetoed.value) {
    ElMessage.error('该营位命中风险否决项，不能推荐')
    return
  }
  if (!form.reason.trim()) {
    ElMessage.warning('请填写推荐理由，理由为空无法提交')
    return
  }
  const site = selectedSite.value
  const row = selectedRow.value
  if (!site || !row || site.id == null) {
    ElMessage.error('营位评分数据缺失，无法留档')
    return
  }
  const profile = profileStore.activeProfile
  submitting.value = true
  try {
    await decisionStore.confirmDecision({
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      campName: site.campName,
      reason: form.reason,
      decidedBy: form.decidedBy.trim() || '未署名',
      snapshot: {
        total: row.total,
        rank: row.rank,
        grade: row.grade,
        profileId: typeof profile?.id === 'number' ? profile.id : null,
        profileName: profile?.name ?? '临时权重',
        normalize: profile?.normalize ?? 'minmax',
        weights: { ...profileStore.activeWeights },
        thresholds: { ...(profile?.thresholds ?? { gradeA: 78, gradeB: 58 }) },
        raw: { ...row.raw },
        vetoed: false,
        vetoTypes: []
      }
    })
    ElMessage.success('已确认推荐并留档：后续调权重或补录评估不影响本记录')
    form.reason = ''
  } catch (err) {
    ElMessage.error(`提交失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

/** 台账列表：新的在前；替代者编号冗余出来便于展示 */
const ledger = computed(() =>
  [...decisionStore.list]
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
    .map((d) => ({
      ...d,
      siteGone: siteStore.byId(d.siteId) == null,
      supersededByCode:
        d.supersededById != null ? (decisionStore.byId(d.supersededById)?.code ?? '—') : ''
    }))
)

const stats = computed(() => ({
  active: decisionStore.activeCount,
  total: decisionStore.list.length,
  latest: ledger.value[0] ? formatDateTime(ledger.value[0].decidedAt) : '—'
}))

function openSite(siteId: number): void {
  if (siteStore.byId(siteId)) void router.push(`/sites/${siteId}`)
}

/** 表格行是 any，归一方式的中文名走函数取值，避免模板里直接索引 Record */
function normalizeLabelOf(method: NormalizeMethod): string {
  return NORMALIZE_LABELS[method] ?? '—'
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>选址决定台账</h1>
        <p>
          确认推荐时把当前得分、名次、等级、权重方案、因子数值与风险状态整体留档；
          之后调整权重或补录评估，名次会重算，台账记录照旧。同一营位只有一份生效推荐，
          改选后旧记录自动标为「已被替代」。
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
      title="留档不随重算变化"
      description="台账保存的是确认那一刻的快照：得分、名次、等级、权重、因子数值与风险状态。命中风险否决的营位不能推荐；推荐理由为空时提交失败。"
    />

    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-card__label">生效中推荐</div>
        <div class="stat-card__value" data-testid="stat-active">{{ stats.active }}</div>
        <div class="stat-card__extra">每个营位至多一份</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">台账记录</div>
        <div class="stat-card__value">{{ stats.total }}</div>
        <div class="stat-card__extra">含已被替代的历史记录</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">当前方案</div>
        <div class="stat-card__value stat-card__value--text">{{ activeProfileName }}</div>
        <div class="stat-card__extra">归一方式：{{ activeNormalize }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">最近决定</div>
        <div class="stat-card__value stat-card__value--text">{{ stats.latest }}</div>
        <div class="stat-card__extra">按确认时间倒序</div>
      </div>
    </div>

    <div class="decision-layout">
      <section class="panel">
        <div class="panel__head">
          <h2>确认推荐</h2>
          <span class="weight-note">快照取当前评分结果</span>
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
              >
                <span>{{ opt.label }}</span>
                <el-tag v-if="opt.vetoed" type="danger" size="small" style="float: right">
                  已否决
                </el-tag>
                <el-tag
                  v-else-if="opt.recommended"
                  type="success"
                  size="small"
                  style="float: right"
                >
                  生效中
                </el-tag>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="决定人">
            <el-input id="decision-by" v-model="form.decidedBy" placeholder="如 李营" />
          </el-form-item>
          <el-form-item label="推荐理由" required>
            <el-input
              id="decision-reason"
              v-model="form.reason"
              type="textarea"
              :rows="3"
              placeholder="为什么此刻推荐这个营位（必填，留档后不可改）"
            />
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary"
              :loading="submitting"
              :disabled="selectedVetoed"
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

        <template v-if="activeOfSelected">
          <el-divider content-position="left">改选提示</el-divider>
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            :title="`该营位已有一份生效推荐（${activeOfSelected.code}）`"
            :description="`确认后新记录生效，${activeOfSelected.code} 将自动标为「已被替代」。原理由：${activeOfSelected.reason}`"
          />
        </template>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>选中营位预览</h2>
          <GradeBadge
            v-if="selectedRow"
            :grade="selectedRow.grade"
            :score="selectedRow.total"
            :vetoed="selectedVetoed"
          />
        </div>
        <template v-if="selectedSite && selectedRow">
          <div class="preview-list">
            <div class="preview-item">
              <span>营位</span>
              <strong>{{ selectedSite.code }} · {{ selectedSite.name }}</strong>
            </div>
            <div class="preview-item">
              <span>当前名次</span>
              <strong>第 {{ selectedRow.rank }} 位 / 共 {{ siteStore.total }} 个</strong>
            </div>
            <div class="preview-item">
              <span>综合得分</span>
              <strong>{{ formatScore(selectedRow.total) }}</strong>
            </div>
            <div class="preview-item">
              <span>风险状态</span>
              <strong :style="selectedVetoed ? 'color: var(--gb-danger)' : undefined">
                {{ selectedVetoed ? `命中否决：${selectedVetos.map((v) => v.type).join('、')}` : '无否决' }}
              </strong>
            </div>
            <div class="preview-item">
              <span>权重方案</span>
              <strong>{{ activeProfileName }}</strong>
            </div>
          </div>
          <el-alert
            v-if="selectedVetoed"
            type="error"
            :closable="false"
            show-icon
            style="margin-top: 10px"
            title="命中风险否决，不能推荐"
            :description="selectedVetos.map((v) => `${v.type}：${v.description}`).join(' ｜ ')"
          />
          <p v-else class="panel__hint">
            提交后以上得分、名次、等级、权重与因子数值将整体留档，之后调权重或补录评估不影响该记录。
          </p>
        </template>
        <p v-else class="panel__hint">请先从左侧选择营位，提交前可在此确认当前评分与风险状态。</p>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>决定台账</h2>
        <span class="weight-note">共 {{ ledger.length }} 条 · 展开行可查看留档快照</span>
      </div>

      <el-table v-if="ledger.length" data-testid="decision-table" :data="ledger" size="small" border stripe>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="snapshot">
              <div class="snapshot__block">
                <h4>因子数值留档（{{ formatDateTime(row.decidedAt) }}）</h4>
                <div class="snapshot-grid">
                  <div v-for="meta in FACTOR_META" :key="meta.key" class="snapshot-item">
                    <span>{{ meta.label }}</span>
                    <strong>{{ formatFactorValue(meta.key, row.snapshot.raw[meta.key]) }}</strong>
                  </div>
                </div>
              </div>
              <div class="snapshot__block">
                <h4>权重留档 · {{ row.snapshot.profileName }}</h4>
                <div class="snapshot-grid">
                  <div v-for="meta in FACTOR_META" :key="meta.key" class="snapshot-item">
                    <span>{{ meta.label }}</span>
                    <strong>{{ row.snapshot.weights[meta.key] }}</strong>
                  </div>
                </div>
                <p class="snapshot__note">
                  归一方式：{{ normalizeLabelOf(row.snapshot.normalize) }} · 等级阈值 A ≥
                  {{ row.snapshot.thresholds.gradeA }} / B ≥ {{ row.snapshot.thresholds.gradeB }}
                  <template v-if="row.status === 'superseded'">
                    · 被 {{ row.supersededByCode }} 替代于 {{ formatDateTime(row.supersededAt) }}
                  </template>
                </p>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="编号" width="96" />
        <el-table-column label="营位" min-width="190">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="openSite(row.siteId)">
              {{ row.siteCode }} · {{ row.siteName }}
            </el-link>
            <div class="cell-sub">
              {{ row.campName }}<span v-if="row.siteGone"> · 营位已删除</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="推荐理由" min-width="220" show-overflow-tooltip />
        <el-table-column label="留档成绩" width="190">
          <template #default="{ row }">
            <GradeBadge
              :grade="row.snapshot.grade"
              :score="row.snapshot.total"
              :vetoed="row.snapshot.vetoed"
              size="small"
              :show-label="false"
            />
            <div class="cell-sub">当时名次第 {{ row.snapshot.rank }} 位</div>
          </template>
        </el-table-column>
        <el-table-column label="权重方案" width="150">
          <template #default="{ row }">
            {{ row.snapshot.profileName }}
            <div class="cell-sub">{{ normalizeLabelOf(row.snapshot.normalize) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="风险状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.snapshot.vetoed" type="danger" size="small">命中否决</el-tag>
            <span v-else class="muted">无否决</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small" effect="plain">
              {{ DECISION_STATUS_LABELS[row.status as 'active' | 'superseded'] }}
            </el-tag>
            <div v-if="row.status === 'superseded'" class="cell-sub">→ {{ row.supersededByCode }}</div>
          </template>
        </el-table-column>
        <el-table-column label="决定人 / 时间" width="170">
          <template #default="{ row }">
            {{ row.decidedBy }}
            <div class="cell-sub">{{ formatDateTime(row.decidedAt) }}</div>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-else
        title="还没有选址决定"
        description="在上方选择营位、填写推荐理由并确认，当前得分、权重、等级、因子数值与风险状态会整体留档；之后名次重算也不影响这份记录。"
        hint="命中风险否决的营位不能推荐；推荐理由为必填项"
      />
    </section>
  </div>
</template>

<style scoped>
.decision-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1080px) {
  .decision-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.stat-card__value--text {
  font-size: 15px;
  line-height: 1.4;
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
}
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.snapshot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  padding: 10px 14px;
  background: var(--gb-surface);
  border-radius: 8px;
}
.snapshot__block h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 6px;
}
.snapshot-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  font-size: 12px;
  background: #ffffff;
  border: 1px solid var(--gb-line);
  border-radius: 6px;
}
.snapshot-item span {
  color: var(--gb-muted);
}
.snapshot__note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
</style>
