import { beginFrameExport, type FrameExportParams } from './frameRenderer'

/**
 * Renders one frame at output resolution × supersample, downsamples, and
 * composites the backdrop under it (§9.1).
 *
 * Everything load-bearing lives in `beginFrameExport` — this is the
 * one-frame case of the same loop the sequence and video exports run.
 */
export async function exportStillPng(params: FrameExportParams): Promise<Blob> {
  const exporter = beginFrameExport(params)
  try {
    return await exporter.renderFrame().convertToBlob({ type: 'image/png' })
  } finally {
    exporter.dispose()
  }
}
