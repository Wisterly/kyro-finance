// Extrator Inteligente de Documentos, Fotos, Câmera e Comprovantes em PDF/Imagem

export async function extractTextFromPdfFile(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Decodifica como latin1 para preservar caracteres binários de streams
    let text = '';
    const chunkSize = 65536;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, i + chunkSize);
      text += String.fromCharCode.apply(null, Array.from(slice));
    }

    const chunks: string[] = [];

    // 1. Extração de strings em blocos PDF (...) Tj ou [...] TJ
    const stringRegex = /\(([^()]{1,250})\)/g;
    let match;
    while ((match = stringRegex.exec(text)) !== null) {
      const raw = match[1].trim();
      if (raw && !raw.startsWith('/') && !raw.startsWith('%') && raw.length > 1) {
        chunks.push(raw);
      }
    }

    // 2. Extração de linhas com termos típicos de comprovante bancário / recibos
    const lines = text.split(/[\r\n]+/);
    for (const line of lines) {
      if (/(?:comprovante|pagamento|transfer[eê]ncia|pix|valor|r\$|benefici[aá]rio|destinat[aá]rio|institui[cç][aã]o|banco|farm[aá]cia|supermercado|restaurante|padaria|produto|descri[cç][aã]o)/i.test(line)) {
        const cleanLine = line.replace(/[^\w\sÀ-ÿ,.$:-]/g, ' ').trim();
        if (cleanLine.length > 3) {
          chunks.push(cleanLine);
        }
      }
    }

    const combined = chunks.join(' ').trim();
    if (combined.length > 5) {
      return combined;
    }
  } catch (err) {
    console.warn('[PDF Extractor]: Falha ao decodificar PDF:', err);
  }

  return file.name.replace(/[._-]/g, ' ');
}

export async function extractTextFromImageFile(file: File): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('por');
    const ret = await worker.recognize(file);
    await worker.terminate();

    const ocrText = (ret?.data?.text || '').trim();
    if (ocrText.length > 5) {
      return ocrText;
    }
  } catch (err) {
    console.warn('[OCR Extractor]: Falha no Tesseract:', err);
  }

  return file.name.replace(/[._-]/g, ' ');
}

export async function processUploadedFinancialDocument(
  file: File, 
  base64Url: string
): Promise<{ text: string; previewUrl: string; isPdf: boolean }> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  let extractedText = '';
  if (isPdf) {
    extractedText = await extractTextFromPdfFile(file);
  } else {
    extractedText = await extractTextFromImageFile(file);
  }

  // Se o texto for muito curto, mescla com o nome do arquivo para garantir contexto
  if (!extractedText || extractedText.length < 5) {
    extractedText = `${file.name.replace(/[._-]/g, ' ')} ${extractedText}`.trim();
  }

  return {
    text: extractedText,
    previewUrl: base64Url,
    isPdf
  };
}
