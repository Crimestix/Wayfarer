/** Liest die Exportdatei von LegendKeeper (.lk): gepacktes JSON. */

const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** Liest eine gewählte Exportdatei. Wirft mit einem deutschen Satz, wenn sie nicht lesbar ist. */
export async function readLkFile(file: Blob): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error('Diese Datei ist zu groß für einen LegendKeeper-Export (über 256 MB).');
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let content: string;
  try {
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined')
        throw new Error('Auspacken wird hier nicht unterstützt.');
      content = await new Response(
        file.stream().pipeThrough(new DecompressionStream('gzip')),
      ).text();
    } else content = await file.text();
  } catch {
    throw new Error(
      'Die Datei ließ sich nicht auspacken. Ist es die unveränderte Datei mit der Endung „.lk“ aus LegendKeeper?',
    );
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(
      'Die Datei ist kein LegendKeeper-Export oder beschädigt. Erwartet wird die Datei mit der Endung „.lk“.',
    );
  }
}
