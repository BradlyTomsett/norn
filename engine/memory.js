/** Local relevance retrieval: retain the source history, budget only the prompt. */
export function selectRelevant(rows, query = '', limit = 16, textOf = x => typeof x === 'string' ? x : x.text || '') {
  const words = new Set(String(query).match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]{2}/g) || []);
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) || []) for (let i = 0; i < run.length - 1; i++) words.add(run.slice(i, i + 2));
  return rows.map((row, index) => {
    const text = textOf(row);
    let score = row?.permanent ? 100 : 0;
    for (const word of words) if (text.includes(word)) score += 10;
    return { row, index, score: score + (rows.length ? index / rows.length : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.index - b.index).map(x => x.row);
}
