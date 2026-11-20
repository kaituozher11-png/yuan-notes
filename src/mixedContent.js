export function insertMixedPart(parts, part, position) {
  const index = parts.findIndex((item) => item.id === position?.partId);
  const target = parts[index];
  if (target?.type === 'text' && Number.isInteger(position.start)) {
    const start = Math.max(0, Math.min(position.start, target.text.length));
    const end = Math.max(start, Math.min(position.end ?? start, target.text.length));
    const before = target.text.slice(0, start);
    const after = target.text.slice(end);
    const trailing = before ? { id: crypto.randomUUID(), type: 'text', text: after } : { ...target, text: after };
    return {
      parts: [
        ...parts.slice(0, index),
        ...(before ? [{ ...target, text: before }] : []),
        part,
        trailing,
        ...parts.slice(index + 1),
      ],
      focusId: trailing.id,
    };
  }
  const at = index < 0 ? parts.length : index + 1;
  const next = parts[at];
  const trailing = next?.type === 'text' ? next : { id: crypto.randomUUID(), type: 'text', text: '' };
  return {
    parts: [...parts.slice(0, at), part, ...(next?.type === 'text' ? [] : [trailing]), ...parts.slice(at)],
    focusId: trailing.id,
  };
}

export function removeMixedPart(parts, partId) {
  const remaining = parts.filter((part) => part.id !== partId);
  return remaining.length ? remaining : [{ id: crypto.randomUUID(), type: 'text', text: '' }];
}
