import type { TranslationSense } from './translation';

/**
 * 其他释义的确定性排序 / 语义去重 / 弱标签。
 * 排序与去重完全由插件完成（不依赖模型返回顺序）；
 * 这里只做展示层的分类与比较，绝不改写 capture/text 等原始数据。
 */

export type FrequencyBand = 'common' | 'regular' | 'uncommon' | 'specialized' | 'rare' | 'archaic';

export interface RankedSense extends TranslationSense {
  /** 规范化后的频率带（模型未提供或无法识别时兜底为 regular）。 */
  frequencyBand: FrequencyBand;
  /** 弱标签（低频/专业/古旧等特殊情况），普通义项为 null。 */
  weakTag: string | null;
}

/** 频率带权重（确定性排序依据）：archaic 最末，common 最前。 */
const BAND_ORDER: Record<FrequencyBand, number> = {
  common: 6,
  regular: 5,
  uncommon: 4,
  specialized: 3,
  rare: 2,
  archaic: 1,
};

/** 模型可能给出的各种写法 → 六档。 */
const BAND_ALIASES: Record<string, FrequencyBand> = {
  common: 'common',
  frequent: 'common',
  everyday: 'common',
  standard: 'common',
  usual: 'common',
  regular: 'regular',
  normal: 'regular',
  ordinary: 'regular',
  typical: 'regular',
  uncommon: 'uncommon',
  infrequent: 'uncommon',
  'less common': 'uncommon',
  lesscommon: 'uncommon',
  specialized: 'specialized',
  specialist: 'specialized',
  technical: 'specialized',
  domain: 'specialized',
  rare: 'rare',
  seldom: 'rare',
  archaic: 'archaic',
  obsolete: 'archaic',
  dated: 'archaic',
  oldfashioned: 'archaic',
  old: 'archaic',
};

/** 专业领域 → 弱标签。 */
export const DOMAIN_LABELS: Record<string, string> = {
  technology: '技术',
  computing: '计算机',
  computer: '计算机',
  medicine: '医学',
  medical: '医学',
  law: '法律',
  legal: '法律',
  biology: '生物',
  biological: '生物',
  music: '音乐',
  linguistics: '语言学',
  economics: '经济',
  finance: '金融',
  chemistry: '化学',
  physics: '物理',
  mathematics: '数学',
  math: '数学',
  sports: '体育',
  cooking: '烹饪',
  nautical: '航海',
  military: '军事',
  psychology: '心理学',
  philosophy: '哲学',
  religion: '宗教',
  history: '历史',
  geography: '地理',
  agriculture: '农业',
  engineering: '工程',
  printing: '印刷',
  literature: '文学',
  anatomy: '解剖',
  geology: '地质',
  astronomy: '天文',
  archaeology: '考古',
  aviation: '航空',
  musicology: '音乐',
  grammar: '语法',
};

/** 语域 → 弱标签。 */
export const REGISTER_LABELS: Record<string, string> = {
  colloquial: '口语',
  informal: '非正式',
  slang: '俚语',
  formal: '书面',
  literary: '文学',
  archaic: '古旧',
  dialect: '方言',
  vulgar: '粗俗',
  obsolete: '废弃',
  dated: '过时',
  poetic: '诗体',
};

/** 词性 → 中文展示名（释义 label 的合法来源之一）。 */
export const SENSE_POS_LABELS: Record<string, string> = {
  noun: '名词',
  verb: '动词',
  adjective: '形容词',
  adverb: '副词',
  pronoun: '代词',
  determiner: '限定词',
  preposition: '介词',
  conjunction: '连词',
  interjection: '感叹词',
  numeral: '数词',
  modal: '情态动词',
  auxiliary: '助动词',
  particle: '小品词',
  'phrasal verb': '短语动词',
};

const SENSE_LABEL_ALIASES: Record<string, string> = (() => {
  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(SENSE_POS_LABELS)) aliases[key] = value;
  for (const [key, value] of Object.entries(DOMAIN_LABELS)) aliases[key] = value;
  for (const [key, value] of Object.entries(REGISTER_LABELS)) aliases[key] = value;
  // 常见缩写/同义写法与中文输入
  Object.assign(aliases, {
    n: '名词', 'n.': '名词', v: '动词', 'v.': '动词', adj: '形容词', 'adj.': '形容词',
    adv: '副词', 'adv.': '副词', pron: '代词', 'pron.': '代词', det: '限定词',
    prep: '介词', 'prep.': '介词', conj: '连词', 'conj.': '连词', interj: '感叹词',
    'interj.': '感叹词', num: '数词', 'num.': '数词', aux: '助动词', 'aux.': '助动词',
    'modal verb': '情态动词', 'phrasal-verb': '短语动词', 'phrase verb': '短语动词',
    名词: '名词', 动词: '动词', 形容词: '形容词', 副词: '副词', 代词: '代词', 限定词: '限定词',
    介词: '介词', 连词: '连词', 感叹词: '感叹词', 数词: '数词', 情态动词: '情态动词',
    助动词: '助动词', 小品词: '小品词', 短语动词: '短语动词',
    spoken: '口语', 'non-standard': '方言', technical: '专业', medical: '医学', legal: '法律',
    技术: '技术', 计算机: '计算机', 医学: '医学', 法律: '法律', 生物: '生物', 音乐: '音乐',
    语言学: '语言学', 经济: '经济', 金融: '金融', 化学: '化学', 物理: '物理', 数学: '数学',
    体育: '体育', 烹饪: '烹饪', 航海: '航海', 军事: '军事', 心理学: '心理学', 哲学: '哲学',
    宗教: '宗教', 历史: '历史', 地理: '地理', 农业: '农业', 工程: '工程', 印刷: '印刷',
    文学: '文学', 解剖: '解剖', 地质: '地质', 天文: '天文', 考古: '考古', 航空: '航空', 语法: '语法',
  });
  return aliases;
})();

/**
 * 释义 label 只能是词性/语域/专业领域；英文近义词、释义词、例句等一律返回空串，
 * 由调用方回退到该义项的 part_of_speech 或通用 "释义"。
 */
export function normalizeSenseLabel(raw: string | undefined): string {
  if (!raw) return '';
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return SENSE_LABEL_ALIASES[key] ?? '';
}

/** 频率带 → 弱标签（只有非常规才显示）。 */
const BAND_TAGS: Partial<Record<FrequencyBand, string>> = {
  uncommon: '较少见',
  specialized: '专业',
  rare: '罕见',
  archaic: '古旧',
};

/** 将模型给的频率描述归一化到六档；缺失或无法识别时兜底为 regular。 */
export function normalizeFrequencyBand(raw: string | undefined | null): FrequencyBand {
  if (!raw) return 'regular';
  const key = raw.trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
  return BAND_ALIASES[key] ?? 'regular';
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[\s\u3000，。、；：！？…—–‐‑‘’“”"'(),.;:!?\-_·*~（）「」『』《》〈〉【】]/g, '');
}

/** 字符集合重叠率（中文释义的主要相似信号）。 */
function charOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  for (const ch of setA) if (setB.has(ch)) common += 1;
  return common / Math.max(setA.size, setB.size);
}

/**
 * 两条释义是否语义高度重复（用于"其他释义"去重）：
 * 1. 归一化后完全相等；
 * 2. 一方包含另一方（≥2 字符，如"状态，境况"与"状态"）；
 * 3. 字符集合重叠率 ≥ 0.6（如"状态，境况"与"状态，状况"）。
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return true;
  return charOverlap(na, nb) >= 0.6;
}

/**
 * 语义去重：先剔除与当前语境高度重复的义项（当前语境已独立置顶展示），
 * 再对剩余义项做保序去重（保留第一条）。不修改任何原始字段。
 */
export function dedupeSenses(currentMeaning: string | undefined, senses: TranslationSense[]): TranslationSense[] {
  const result: TranslationSense[] = [];
  for (const sense of senses) {
    if (currentMeaning && isNearDuplicate(sense.meaning, currentMeaning)) continue;
    if (result.some((prev) => isNearDuplicate(prev.meaning, sense.meaning))) continue;
    result.push(sense);
  }
  return result;
}

/**
 * 弱标签：一个义项最多一个。
 * 优先级：频率带（古旧/罕见/专业/较少见）> 专业领域（技术/医学/法律…）> 语域（口语/俚语…）。
 * common/regular 且无领域/语域 → null（高频普通义项不显示任何标签）。
 */
export function computeWeakTag(sense: TranslationSense): string | null {
  const band = normalizeFrequencyBand(sense.frequencyBand);
  const bandTag = BAND_TAGS[band];
  if (bandTag) return bandTag;
  const domain = sense.domain ? DOMAIN_LABELS[sense.domain.trim().toLowerCase()] : undefined;
  if (domain) return domain;
  const register = sense.register ? REGISTER_LABELS[sense.register.trim().toLowerCase()] : undefined;
  return register ?? null;
}

/**
 * 确定性排序：六档频率权重降序，同一档内保持模型原始顺序（稳定排序）。
 * 低频/专业/古旧义项自然落在末尾。
 */
export function rankSenses(senses: TranslationSense[]): RankedSense[] {
  return senses
    .map((sense) => ({ ...sense, frequencyBand: normalizeFrequencyBand(sense.frequencyBand), weakTag: computeWeakTag(sense) }))
    .sort((a, b) => BAND_ORDER[b.frequencyBand] - BAND_ORDER[a.frequencyBand]);
}

export const DEFAULT_VISIBLE_SENSES = 3;
export const FULL_LIST_THRESHOLD = 4;

export interface SenseView {
  visibleCount: number;
  showToggle: boolean;
  toggleLabel: string;
}

/**
 * 展开规则（纯函数，可测）：
 * - 总数 ≤ 4：全部显示，无按钮；
 * - 总数 > 4：默认展示价值最高的 3 条（排序后前 3），按钮"查看其余 N 条释义"；
 * - 展开后按钮变为"收起释义"。
 */
export function senseView(sensesCount: number, expanded: boolean): SenseView {
  if (sensesCount <= FULL_LIST_THRESHOLD) return { visibleCount: sensesCount, showToggle: false, toggleLabel: '' };
  if (expanded) return { visibleCount: sensesCount, showToggle: true, toggleLabel: '收起释义' };
  return { visibleCount: DEFAULT_VISIBLE_SENSES, showToggle: true, toggleLabel: `查看其余 ${sensesCount - DEFAULT_VISIBLE_SENSES} 条释义` };
}
