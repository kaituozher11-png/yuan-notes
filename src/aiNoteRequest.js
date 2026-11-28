// No application token cap: the provider chooses the available output budget.
// Bound recovery attempts, not note length. Never treat a truncated JSON as saved work.
const continuationLimit = 3;

function interruptedOutput() {
  return Object.assign(new Error('模型输出被截断，自动续写仍未完成；本页未保存，可仅重试失败页。服务商可能限制了单次输出长度'), { code: 'NOTE_OUTPUT_TRUNCATED' });
}

function parseAnswer(answer, test) {
  const text = answer.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  for (const candidate of [text, fenced, start >= 0 && end > start ? text.slice(start, end + 1) : null]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Try common wrappers, never repair missing JSON or math. */ }
  }
  throw new Error(test ? '模型已连接，但未按要求返回笔记格式；请核对模型 ID 或更换模型' : '模型未返回可读取的笔记格式，请重试');
}

export async function requestNoteJson({ messages, send, signal, test = false }) {
  let answer = '';
  let continued = false;
  for (let attempt = 0; attempt <= continuationLimit; attempt++) {
    signal?.throwIfAborted();
    const choice = await send(answer ? [...messages,
      { role: 'assistant', content: answer },
      { role: 'user', content: '上一条输出被服务商截断。请从断点原样继续，只输出尚未输出的剩余 JSON 字符；若断点在字符串或公式内，先继续该字符串或公式。不要从头生成、重复已输出内容、添加说明或代码围栏，保留全部标题与内容，最终补全合法 JSON。' },
    ] : messages);
    signal?.throwIfAborted();
    if (choice?.finish_reason === 'content_filter') throw new Error('模型服务拦截了本页输出，未保存笔记');
    const truncated = ['length', 'max_tokens', 'max_output_tokens'].includes(choice?.finish_reason);
    const content = choice?.message?.content;
    if (typeof content !== 'string' && !(truncated && content == null)) throw new Error('模型返回内容格式不兼容');
    answer += content || '';
    if (!truncated) {
      try { return parseAnswer(answer, test); }
      catch (error) { if (continued) throw interruptedOutput(); throw error; }
    }
    continued = true;
  }
  throw interruptedOutput();
}
