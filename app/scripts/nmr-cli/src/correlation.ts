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
import { isSpectrum2D } from './parse/data/data2d/isSpectrum2D'

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

  if (state.data) {
    processSpectra(
      state.data,
      { autoProcessing: true, autoDetection: true },
      logger
    )
  }

  // buildCorrelationData needs detected ranges (1D) or zones (2D) to find
  // correlations, so require isFt plus at least one detected range/zone.
  // This also excludes spectra that failed to initiate or failed detection,
  // since those never get ranges/zones populated either.
  // Note: a pre-existing bug (see https://github.com/NFDI4Chem/nmrkit/issues/139)
  // currently makes every spectrum fail initiation, so real cross-spectrum correlation links are untested here.
  const spectra = (state.data?.spectra ?? []).filter(spectrum => {
    if (spectrum?.info?.isFt !== true) return false
    return isSpectrum2D(spectrum)
      ? (spectrum.zones?.values?.length ?? 0) > 0
      : (spectrum.ranges?.values?.length ?? 0) > 0
  })

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
