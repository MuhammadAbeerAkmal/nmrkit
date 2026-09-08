import { buildCorrelationData } from 'nmr-correlation'
import type { Options as CorrelationOptions, Spectra } from 'nmr-correlation'
import { FifoLogger } from 'fifo-logger'
import {
  buildWebSource,
  core,
  loadFileCollection,
  parsingOptions,
  processSpectra,
} from './parse/prase-spectra'

// Default tolerances confirmed by vcnainala on issue #66
const DEFAULT_TOLERANCE_H = 0.02
const DEFAULT_TOLERANCE_C = 0.25

export interface CorrelationInput {
  url?: string
  dir?: string
  mf: string
  toleranceH?: number
  toleranceC?: number
}

function resolveTolerance(value: number | undefined, fallback: number): number {
  return value === undefined || Number.isNaN(value) ? fallback : value
}

export async function generateCorrelationData(input: CorrelationInput) {
  const { url, dir, mf, toleranceH, toleranceC } = input
  const logger = new FifoLogger()

  let state
  if (url) {
    ;({ state } = await core.readFromWebSource(buildWebSource(url), {
      ...parsingOptions,
      logger,
    }))
  } else if (dir) {
    ;({ state } = await core.read(await loadFileCollection(dir), {
      ...parsingOptions,
      logger,
    }))
  } else {
    throw new Error(
      'Either a spectra URL or a local directory path is required'
    )
  }

  const spectraBeforeProcessing = state.data ? [...state.data.spectra] : []

  if (state.data) {
    processSpectra(
      state.data,
      { autoProcessing: true, autoDetection: true },
      logger
    )
  }

  // Two independent checks, not redundant with each other:
  // 1. Reference check: processSpectra replaces a spectrum's array slot with
  //    a new object only when initiateDatum1D/initiateDatum2D succeeds; on
  //    failure it leaves the original raw object in place (see its catch
  //    block) instead of removing it. info.isFt is set at file-load time,
  //    before this step even runs, so a spectrum whose source data is
  //    already tagged FT can still fail here and keep isFt: true on its
  //    broken, incompletely-initialized object, the isFt check alone
  //    wouldn't catch that case.
  // 2. isFt check: correlation requires FT (frequency-domain) spectra
  //    specifically; a spectrum can successfully initiate but still fail
  //    the separate FT-processing step (that failure is only logged, not
  //    removed from the array), leaving it as valid-but-still-FID data.
  // Both together ensure buildCorrelationData only ever sees a spectrum
  // that both initiated successfully and is genuinely FT-processed.
  // Note: a pre-existing bug (see https://github.com/NFDI4Chem/nmrkit/issues/139)
  // currently makes every spectrum fail this step, so real cross-spectrum correlation links are untested here.
  const spectra = (state.data?.spectra ?? []).filter(
    (spectrum, index) =>
      spectrum !== spectraBeforeProcessing[index] &&
      spectrum?.info?.isFt === true
  )

  const options: CorrelationOptions = {
    mf,
    tolerance: {
      H: resolveTolerance(toleranceH, DEFAULT_TOLERANCE_H),
      C: resolveTolerance(toleranceC, DEFAULT_TOLERANCE_C),
    },
  }

  let correlationData
  try {
    correlationData = buildCorrelationData(spectra as Spectra, options)
  } catch (error) {
    throw new Error(
      `Failed to build correlation data: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return { ...correlationData, logs: logger.getLogs() }
}
