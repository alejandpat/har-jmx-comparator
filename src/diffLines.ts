/**
 * Diff de líneas estilo git (vista unificada), sin dependencias externas.
 * Usa LCS sobre líneas con recorte de prefijo/sufijo común para reducir el
 * tamaño del problema, y un límite de seguridad para bodies enormes.
 */

export type DiffLineType = "same" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  /** Número de línea en el body base (1-based), si aplica. */
  lineBefore?: number;
  /** Número de línea en el body comparado (1-based), si aplica. */
  lineAfter?: number;
}

/** Límite de celdas del DP; por encima se hace un diff por índice (fallback). */
const DP_MAX_CELLS = 4_000_000;

/**
 * Calcula la subsecuencia común más larga entre dos secuencias de líneas
 * y devuelve los pares de índices emparejados.
 */
function lcsLinePairs(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length;
  const cols = b.length;
  // dp[i][j] = longitud LCS de a[i..] y b[j..]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= rows; i++) dp.push(new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Compara dos textos línea a línea y devuelve la secuencia de DiffLine
 * para renderizar una vista unificada estilo `git diff`.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Recorta el prefijo y sufijo común: reduce drásticamente el DP.
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;
  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (endBefore > start && endAfter > start && beforeLines[endBefore - 1] === afterLines[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const prefix: DiffLine[] = beforeLines.slice(0, start).map((text, i) => ({ type: "same", text, lineBefore: i + 1, lineAfter: i + 1 }));
  const suffix: DiffLine[] = beforeLines.slice(endBefore).map((text, i) => ({
    type: "same",
    text,
    lineBefore: endBefore + i + 1,
    lineAfter: endAfter + i + 1,
  }));

  const midBefore = beforeLines.slice(start, endBefore);
  const midAfter = afterLines.slice(start, endAfter);

  const middle: DiffLine[] = [];
  if (midBefore.length * midAfter.length > DP_MAX_CELLS) {
    // Fallback para bodies enormes: empareja por índice.
    const maxLen = Math.max(midBefore.length, midAfter.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < midBefore.length && i < midAfter.length && midBefore[i] === midAfter[i]) {
        middle.push({ type: "same", text: midBefore[i], lineBefore: start + i + 1, lineAfter: start + i + 1 });
      } else {
        if (i < midBefore.length) middle.push({ type: "removed", text: midBefore[i], lineBefore: start + i + 1 });
        if (i < midAfter.length) middle.push({ type: "added", text: midAfter[i], lineAfter: start + i + 1 });
      }
    }
  } else {
    const pairs = lcsLinePairs(midBefore, midAfter);
    const matchedBefore = new Set<number>();
    const matchedAfter = new Set<number>();
    for (const [bi, ai] of pairs) {
      matchedBefore.add(bi);
      matchedAfter.add(ai);
    }
    // Intercala líneas eliminadas, añadidas y comunes en orden de aparición.
    let bi = 0, ai = 0;
    while (bi < midBefore.length || ai < midAfter.length) {
      if (bi < midBefore.length && !matchedBefore.has(bi)) {
        middle.push({ type: "removed", text: midBefore[bi], lineBefore: start + bi + 1 });
        bi++;
      } else if (ai < midAfter.length && !matchedAfter.has(ai)) {
        middle.push({ type: "added", text: midAfter[ai], lineAfter: start + ai + 1 });
        ai++;
      } else {
        // Ambos actuales están emparejados: avanzan juntos (misma línea).
        middle.push({ type: "same", text: midBefore[bi], lineBefore: start + bi + 1, lineAfter: start + ai + 1 });
        bi++;
        ai++;
      }
    }
  }
  return [...prefix, ...middle, ...suffix];
}

/**
 * Calcula el prefijo y sufijo común de dos strings y devuelve el segmento
 * central que realmente difiere, para resaltar el cambio dentro de una línea.
 */
export function changedSegment(before: string, after: string): { before: [number, number]; after: [number, number] } {
  let start = 0;
  const minLen = Math.min(before.length, after.length);
  while (start < minLen && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { before: [start, endBefore], after: [start, endAfter] };
}
