export async function* parseDataOnlySse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = readFrameData(frame);
        if (data !== undefined) yield data;
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    const data = readFrameData(buffer);
    if (data !== undefined) yield data;
  } finally {
    reader.releaseLock();
  }
}

function readFrameData(frame: string): string | undefined {
  const dataLines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join('\n') : undefined;
}
