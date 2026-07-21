import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  assertBodeParity,
  assertDatasetParity,
  assertDesignParity,
  assertFixtureShape,
  assertStageParity,
} from './assertions.js'

const fixtures = JSON.parse(
  await readFile(new URL('./pyodide-golden.json', import.meta.url), 'utf8'),
)

test('golden fixture has the required coverage', () => {
  assertFixtureShape(fixtures)
  const tags = new Set(fixtures.designs.flatMap((testCase) => testCase.tags ?? []))
  for (const filterType of ['LP', 'HP', 'BP', 'BR', 'GD']) {
    assert(tags.has(`filter:${filterType}`), `missing ${filterType}`)
  }
  for (const approximation of [
    'Butterworth',
    'Chebyshev I',
    'Chebyshev II',
    'Cauer',
    'Legendre',
    'Bessel',
    'Gauss',
  ]) {
    assert(tags.has(`approx:${approximation}`), `missing ${approximation}`)
  }
  for (const denorm of [0, 50, 100]) {
    assert(tags.has(`denorm:${denorm}`), `missing denormalization ${denorm}`)
  }
  for (const normtype of ['Passband', 'ω→0', 'ω→∞', 'ω→ω0']) {
    assert(
      fixtures.stages.some((testCase) => testCase.request.normtype === normtype),
      `missing stage normalization ${normtype}`,
    )
  }
  assert(fixtures.designs.some((testCase) => testCase.tags?.includes('high-order')))
  assert(fixtures.designs.some((testCase) => testCase.tags?.includes('near-boundary')))
  assert(fixtures.designs.filter((testCase) => testCase.tags?.includes('invalid')).length >= 5)
})

test('parity helpers accept the Pyodide oracle values', () => {
  for (const design of fixtures.designs) {
    assertDesignParity(design.outcome, design.outcome, fixtures.tolerances)
    if (design.bode) {
      assertBodeParity(design.bode.outcome, design.bode.outcome, fixtures.tolerances)
    }
  }
  for (const stage of fixtures.stages) {
    assertStageParity(stage.outcome, stage.outcome, fixtures.tolerances)
  }
  for (const dataset of fixtures.datasets) {
    assertDatasetParity(dataset.outcome, dataset.outcome, fixtures.tolerances)
  }
})

test('parity helper enforces exact order decisions', () => {
  const design = fixtures.designs.find((testCase) => testCase.outcome.ok)
  const changed = structuredClone(design.outcome)
  changed.value.N += 1
  assert.throws(
    () => assertDesignParity(changed, design.outcome, fixtures.tolerances),
    /selected order/,
  )
})
