import hwpWasmUrl from '@rhwp/core/rhwp_bg.wasm?url'

const HWP_EXTENSIONS = ['.hwp', '.hwpx']
const MAX_EXTRACTED_TEXT_LENGTH = 200_000

type TextRun = {
  text: string
  x: number
  y: number
  h: number
}

type PageTextLayout = {
  runs?: TextRun[]
}

let initializeHwp: Promise<typeof import('@rhwp/core')> | null = null

function extensionOf(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function isHwpFile(file: File) {
  return HWP_EXTENSIONS.includes(extensionOf(file.name))
}

async function getHwpParser() {
  if (!initializeHwp) {
    initializeHwp = import('@rhwp/core').then(async (hwp) => {
      await hwp.default({ module_or_path: hwpWasmUrl })
      return hwp
    }).catch((error) => {
      initializeHwp = null
      throw error
    })
  }
  return initializeHwp
}

function pageLayoutToText(layoutJson: string) {
  const { runs = [] } = JSON.parse(layoutJson) as PageTextLayout
  const visibleRuns = runs
    .filter((run) => run.text.trim())
    .sort((first, second) => {
      const sameLine = Math.abs(first.y - second.y) <= Math.max(2, Math.min(first.h, second.h) * 0.25)
      return sameLine ? first.x - second.x : first.y - second.y
    })

  const lines: Array<{ y: number; height: number; text: string }> = []
  for (const run of visibleRuns) {
    const currentLine = lines.at(-1)
    const sameLine = currentLine && Math.abs(currentLine.y - run.y) <= Math.max(2, Math.min(currentLine.height, run.h) * 0.25)
    const text = run.text.replace(/\s+/g, ' ').trim()
    if (!sameLine) {
      lines.push({ y: run.y, height: run.h, text })
      continue
    }
    currentLine.text = `${currentLine.text} ${text}`.trim()
  }

  return lines.map((line) => line.text).join('\n')
}

export async function extractHwpText(file: File) {
  const { HwpDocument } = await getHwpParser()
  const document = new HwpDocument(new Uint8Array(await file.arrayBuffer()))

  try {
    const pages: string[] = []
    let extractedLength = 0
    for (let page = 0; page < document.pageCount(); page += 1) {
      const pageText = pageLayoutToText(document.getPageTextLayout(page))
      if (!pageText) continue

      const remainingLength = MAX_EXTRACTED_TEXT_LENGTH - extractedLength
      if (remainingLength <= 0) break
      pages.push(`[${page + 1}쪽]\n${pageText.slice(0, remainingLength)}`)
      extractedLength += pageText.length
    }

    const text = pages.join('\n\n').trim()
    if (!text) throw new Error('문서에서 분석할 텍스트를 찾지 못했습니다.')
    if (extractedLength >= MAX_EXTRACTED_TEXT_LENGTH) {
      return `${text}\n\n[문서가 길어 이후 내용은 생략되었습니다.]`
    }
    return text
  } finally {
    document.free()
  }
}
