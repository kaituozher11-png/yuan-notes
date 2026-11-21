export const aiNotePresets = {
  course: {
    name: '课件笔记生成',
    titles: ['本页内容概览', '核心概念', '重点与难点', '公式与图表', '易错点与注意事项', '课后自测'],
  },
  paper: {
    name: '论文笔记生成',
    titles: ['研究问题与背景', '核心方法', '关键公式与图表', '实验设计与结果', '主要结论', '局限与待思考问题'],
  },
};

const legacyTitles = [
  ['summary', '这页讲什么'], ['concepts', '核心概念'], ['important', '重点与难点'],
  ['cautions', '易错点与注意事项'], ['formula', '公式与图表'], ['quiz', '快速自测'],
];

export function validateAiOutline(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error('请设置 1 到 12 个笔记标题');
  }
  const titles = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (titles.some((title) => !title || title.length > 60)) {
    throw new Error('笔记标题不能为空，且不能超过 60 个字符');
  }
  if (new Set(titles).size !== titles.length) throw new Error('笔记标题不能重复');
  return titles;
}

export function aiNoteSections(ai) {
  if (Array.isArray(ai?.sections)) return ai.sections.map((section, index) => ({
    key: `section-${index}`,
    title: String(section.title || ''),
    value: String(section.content || ''),
    kind: 'custom',
    index,
  }));
  return legacyTitles.map(([key, title]) => ({ key, title, value: ai?.[key], kind: key }))
    .filter((section) => section.value && (!Array.isArray(section.value) || section.value.length));
}

export function validateAiGuidance(value) {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('补充生成要求不能超过 1000 个字符');
  return value.trim();
}

export function generationInstruction(page, outline, guidance = '') {
  if (outline === undefined) {
    return `你是学习笔记整理助手。仅依据提供的第 ${page} 页资料，返回一个合法 JSON 对象，不要代码块或额外说明。字段：summary 字符串；concepts、important、cautions、formula、quiz 为字符串数组。JSON 字符串中的 LaTeX 反斜杠必须按 JSON 规则转义。formula 中每条可确认的数学公式用 LaTeX 的 $...$ 包裹，函数名用 \\operatorname{}，乘号用 \\times；公式后的中文说明写在 $...$ 外。仅有文字说明时保留文字，不猜测缺失的公式。资料不明确时说明待核对，不编造。`;
  }
  const titles = validateAiOutline(outline);
  const request = validateAiGuidance(guidance);
  return `你是学习笔记整理助手。仅依据提供的第 ${page} 页资料，按以下标题及顺序生成笔记：${JSON.stringify(titles)}。只返回合法 JSON 对象，不要代码块或额外说明。格式为 {"sections":[{"content":"该标题的笔记内容"}]}，sections 的数量必须与标题数量相同，按顺序逐项填写；不要增加其他标题。每项 content 为 Markdown 字符串，可使用列表；能确认的公式用 LaTeX 的 $...$ 包裹，JSON 字符串中的反斜杠按 JSON 规则转义。无法从本页确认的内容写“本页未涉及”或“待核对”，不要编造。${request ? `用户的补充生成要求：${request}。仅在原文支持时遵循。` : ''}`;
}

export function normalizeAiAnswer(ai, outline) {
  if (outline === undefined) {
    if (typeof ai?.summary !== 'string') throw new Error('模型返回的笔记缺少摘要');
    for (const key of ['concepts', 'important', 'cautions', 'formula', 'quiz']) {
      ai[key] = Array.isArray(ai[key]) ? ai[key].map(String) : [];
    }
    delete ai.evidence;
    return ai;
  }
  const titles = validateAiOutline(outline);
  if (!Array.isArray(ai?.sections) || ai.sections.length !== titles.length ||
      ai.sections.some((section) => !section || typeof section.content !== 'string')) {
    throw new Error('模型未按所选标题返回完整笔记，请重试或更换模型');
  }
  return { sections: titles.map((title, index) => ({ title, content: ai.sections[index].content })) };
}
