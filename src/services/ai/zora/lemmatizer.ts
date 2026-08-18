/**
 * 确定性英语词形还原（lemmatization）。
 * 用于把 surface form（原文词形）还原为词典原形 lemma：
 *   bewilderments → bewilderment / went → go / better → good / children → child
 *
 * 策略（只做高置信还原；不确定时保持原形）：
 * - 明确的不规则表（保留人工决策：如 lives→life、axes→axis、people→person）；
 * - 其余屈折交给 wink-lemmatizer（WordNet Morphy）按后缀分支验证：
 *   -ed → verb，复数 -s → noun（带不变复数黑名单），-er/-est → adjective；
 *   -ing 只还原词典可确认的双写辅音形（running→run），普通 -ing 保守保留。
 * - 词典无法确认的形变原样返回，绝不产出 funde/lik/sery 这类假 lemma。
 */

import wink from 'wink-lemmatizer';

/** 不规则复数（多数也覆盖第三人称单数 -s/-es）。 */
const IRREGULAR_PLURALS: Record<string, string> = {
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  geese: 'goose',
  oxen: 'ox',
  people: 'person',
  wives: 'wife',
  lives: 'life',
  knives: 'knife',
  leaves: 'leaf',
  shelves: 'shelf',
  wolves: 'wolf',
  halves: 'half',
  selves: 'self',
  loaves: 'loaf',
  thieves: 'thief',
  scarves: 'scarf',
  indices: 'index',
  analyses: 'analysis',
  crises: 'crisis',
  axes: 'axis',
  bases: 'basis',
  oases: 'oasis',
  theses: 'thesis',
  diagnoses: 'diagnosis',
  hypotheses: 'hypothesis',
  phenomena: 'phenomenon',
  criteria: 'criterion',
  media: 'medium',
  data: 'datum',
  bacteria: 'bacterium',
  curricula: 'curriculum',
  memoranda: 'memorandum',
};

/** 不规则动词 / 形容词 / 副词变形（过去式、过去分词、比较级等）。 */
const IRREGULAR_FORMS: Record<string, string> = {
  // 动词过去式/过去分词
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  went: 'go', gone: 'go',
  saw: 'see', seen: 'see',
  did: 'do', done: 'do', does: 'do',
  had: 'have', has: 'have',
  made: 'make',
  came: 'come',
  took: 'take', taken: 'take',
  got: 'get', gotten: 'get',
  gave: 'give', given: 'give',
  found: 'find',
  thought: 'think',
  knew: 'know', known: 'know',
  left: 'leave',
  felt: 'feel',
  kept: 'keep',
  sent: 'send',
  spent: 'spend',
  told: 'tell',
  sold: 'sell',
  bought: 'buy',
  brought: 'bring',
  caught: 'catch',
  taught: 'teach',
  fought: 'fight',
  sought: 'seek',
  said: 'say',
  paid: 'pay',
  laid: 'lay',
  stood: 'stand',
  understood: 'understand',
  heard: 'hear',
  met: 'meet',
  read: 'read',
  led: 'lead',
  lost: 'lose',
  won: 'win',
  ran: 'run',
  begun: 'begin', began: 'begin',
  become: 'become', became: 'become',
  broke: 'break', broken: 'break',
  chose: 'choose', chosen: 'choose',
  spoke: 'speak', spoken: 'speak',
  woke: 'wake', woken: 'wake',
  wrote: 'write', written: 'write',
  rode: 'ride', ridden: 'ride',
  drove: 'drive', driven: 'drive',
  rose: 'rise', risen: 'rise',
  ate: 'eat', eaten: 'eat',
  fell: 'fall', fallen: 'fall',
  forgot: 'forget', forgotten: 'forget',
  froze: 'freeze', frozen: 'freeze',
  grew: 'grow', grown: 'grow',
  threw: 'throw', thrown: 'throw',
  flew: 'fly', flown: 'fly',
  drew: 'draw', drawn: 'draw',
  wore: 'wear', worn: 'wear',
  swore: 'swear', sworn: 'swear',
  tore: 'tear', torn: 'tear',
  bore: 'bear', borne: 'bear', born: 'bear',
  stole: 'steal', stolen: 'steal',
  struck: 'strike', stricken: 'strike',
  swung: 'swing',
  swam: 'swim', swum: 'swim',
  sang: 'sing', sung: 'sing',
  rang: 'ring', rung: 'ring',
  drank: 'drink', drunk: 'drink',
  sat: 'sit',
  slept: 'sleep',
  wept: 'weep',
  crept: 'creep',
  swept: 'sweep',
  dealt: 'deal',
  meant: 'mean',
  lent: 'lend',
  bent: 'bend',
  built: 'build',
  hid: 'hide', hidden: 'hide',
  bit: 'bite', bitten: 'bite',
  lit: 'light', lighted: 'light',
  slid: 'slide',
  held: 'hold',
  shook: 'shake', shaken: 'shake',
  blew: 'blow', blown: 'blow',
  overcame: 'overcome',
  undertook: 'undertake', undertaken: 'undertake',
  withdrew: 'withdraw', withdrawn: 'withdraw',
  // 形容词/副词比较级与最高级（仅真不规则）
  better: 'good', best: 'good',
  worse: 'bad', worst: 'bad',
  more: 'much', most: 'much',
  less: 'little', least: 'little',
  further: 'far', furthest: 'far', farther: 'far', farthest: 'far',
  elder: 'old', eldest: 'old',
};

/**
 * wink-lemmatizer 会把一些集合名词/不变复数误当普通复数拆掉。
 * 这些词在阅读里更常以原形出现，明确保持 surface。
 */
const INVARIANT_S_WORDS = new Set([
  'checkers', 'clothes', 'congratulations', 'corps', 'goods', 'jeans',
  'means', 'odds', 'outskirts', 'pants', 'physics', 'premises',
  'scissors', 'series', 'shorts', 'species', 'stairs', 'statistics',
  'sunglasses', 'thanks', 'trousers',
]);

/** 单词是否值得做词形还原（全字母词，非数字/缩写）。 */
function looksLikeWord(value: string): boolean {
  return /^[A-Za-z][A-Za-z'-]*$/.test(value);
}

/**
 * 把 surface form 还原为 lemma。
 * 无法高置信还原时原样返回（小写化），避免把词典请求发向一个不存在的假 headword。
 */
export function lemmatize(surface: string): string {
  const trimmed = surface.trim();
  if (!trimmed || !looksLikeWord(trimmed)) return trimmed;

  // 句首大写先还原为小写（单字母保持原样，如 I）。
  const lower = trimmed.length > 1 && trimmed.charAt(0) === trimmed.charAt(0).toUpperCase()
    ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
    : trimmed;
  const key = lower.toLowerCase();

  const irregular = IRREGULAR_FORMS[key] ?? IRREGULAR_PLURALS[key];
  if (irregular) return irregular;
  if (key.endsWith("'s")) return key;

  // 过去式/过去分词：wink 的 WordNet Morphy 能区分 stop/stopped、like/liked、fund/funded。
  if (key.endsWith('ed')) {
    const lemma = wink.verb(key);
    return lemma && lemma !== key ? lemma : key;
  }

  // -ing：保持旧产品决策，只还原高置信的双写辅音形（running→run）。
  // 普通 -ing（looking/morning/interesting）原样保留，避免把形容词性分词误还原成动词。
  if (/[aeiou]([bcdfgjklmnpqrstvz])\1ing$/.test(key)) {
    const candidate = key.slice(0, -4);
    if (wink.verb(key) === candidate) return candidate;
  }

  // 复数：交给名词 Morphy；黑名单挡住 series/species/goods 等不变复数。
  if (key.endsWith('s') && !/(?:ss|us|is)$/.test(key)) {
    if (INVARIANT_S_WORDS.has(key)) return key;
    const lemma = wink.noun(key);
    return lemma && lemma !== key ? lemma : key;
  }

  // 比较级/最高级：wink 能确认 taller→tall，也能让 paper/summer 原样通过。
  if (key.endsWith('er') || key.endsWith('est')) {
    const lemma = wink.adjective(key);
    return lemma && lemma !== key ? lemma : key;
  }

  return key;
}
