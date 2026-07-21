function fail(message) {
  throw new Error(`Engine parity failure: ${message}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

export function numbersClose(actual, expected, tolerance) {
  if (Object.is(actual, expected)) return true
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false
  return Math.abs(actual - expected) <= Math.max(
    tolerance.absolute,
    tolerance.relative * Math.max(Math.abs(actual), Math.abs(expected)),
  )
}

export function assertNumberArrayClose(actual, expected, tolerance, label) {
  assert(Array.isArray(actual), `${label} is not an array`)
  assert(actual.length === expected.length, `${label} length ${actual.length} !== ${expected.length}`)
  for (let index = 0; index < expected.length; index += 1) {
    if (!numbersClose(actual[index], expected[index], tolerance)) {
      fail(`${label}[${index}] ${actual[index]} !== ${expected[index]}`)
    }
  }
}

function complexDistance([actualReal, actualImaginary], [expectedReal, expectedImaginary]) {
  return Math.hypot(actualReal - expectedReal, actualImaginary - expectedImaginary)
}

function complexTolerance(actual, expected, tolerance) {
  const scale = Math.max(Math.hypot(...actual), Math.hypot(...expected))
  return Math.max(tolerance.absolute, tolerance.relative * scale)
}

/**
 * Compare roots as multisets. Pole/zero ordering is not part of the contract.
 */
export function assertComplexMultisetClose(actual, expected, tolerance, label) {
  assert(Array.isArray(actual), `${label} is not an array`)
  assert(actual.length === expected.length, `${label} length ${actual.length} !== ${expected.length}`)
  const unmatched = [...actual]
  for (const expectedValue of expected) {
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < unmatched.length; index += 1) {
      const distance = complexDistance(unmatched[index], expectedValue)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
    const actualValue = unmatched[nearestIndex]
    if (nearestIndex < 0 || nearestDistance > complexTolerance(actualValue, expectedValue, tolerance)) {
      fail(`${label} has no match for [${expectedValue.join(', ')}]`)
    }
    unmatched.splice(nearestIndex, 1)
  }
}

export function assertDesignParity(actualOutcome, expectedOutcome, tolerances) {
  assert(actualOutcome.ok === expectedOutcome.ok, 'design validity differs')
  if (!expectedOutcome.ok) return

  const actual = actualOutcome.value
  const expected = expectedOutcome.value
  assert(actual.N === expected.N, `selected order ${actual.N} !== ${expected.N}`)
  assertComplexMultisetClose(actual.zeros, expected.zeros, tolerances.zpk, 'zeros')
  assertComplexMultisetClose(actual.poles, expected.poles, tolerances.zpk, 'poles')
  assert(numbersClose(actual.gain, expected.gain, tolerances.coefficients), 'gain differs')
  assertNumberArrayClose(actual.num, expected.num, tolerances.coefficients, 'numerator')
  assertNumberArrayClose(actual.den, expected.den, tolerances.coefficients, 'denominator')
}

export function assertBodeParity(actualOutcome, expectedOutcome, tolerances) {
  assert(actualOutcome.ok === expectedOutcome.ok, 'Bode validity differs')
  if (!expectedOutcome.ok) return
  assertNumberArrayClose(
    actualOutcome.value.freq,
    expectedOutcome.value.freq,
    tolerances.coefficients,
    'frequency',
  )
  assertNumberArrayClose(
    actualOutcome.value.magnitude,
    expectedOutcome.value.magnitude,
    tolerances.magnitude,
    'magnitude',
  )
  assertNumberArrayClose(
    actualOutcome.value.phase,
    expectedOutcome.value.phase,
    tolerances.phaseDegrees,
    'phase',
  )
  assertNumberArrayClose(
    actualOutcome.value.groupDelay,
    expectedOutcome.value.groupDelay,
    tolerances.groupDelaySeconds,
    'group delay',
  )
}

export function assertStageParity(actualOutcome, expectedOutcome, tolerances) {
  assert(actualOutcome.ok === expectedOutcome.ok, 'stage validity differs')
  if (!expectedOutcome.ok) return
  assertNumberArrayClose(
    actualOutcome.value.num,
    expectedOutcome.value.num,
    tolerances.coefficients,
    'stage numerator',
  )
  assertNumberArrayClose(
    actualOutcome.value.den,
    expectedOutcome.value.den,
    tolerances.coefficients,
    'stage denominator',
  )
  assert(
    numbersClose(actualOutcome.value.gain, expectedOutcome.value.gain, tolerances.coefficients),
    'stage gain differs',
  )
}

export function assertDatasetParity(actualOutcome, expectedOutcome, tolerances) {
  assert(actualOutcome.ok === expectedOutcome.ok, 'dataset validity differs')
  if (!expectedOutcome.ok) return
  const actual = actualOutcome.value
  const expected = expectedOutcome.value
  for (const field of [
    'cases',
    'suggestedXsource',
    'suggestedYsource',
    'suggestedXscale',
    'suggestedYscale',
    'miscinfo',
  ]) {
    assert(Object.is(actual[field], expected[field]), `dataset ${field} differs`)
  }
  for (const field of ['fields', 'casenames']) {
    assert(
      JSON.stringify(actual[field]) === JSON.stringify(expected[field]),
      `dataset ${field} differs`,
    )
  }
  assert(actual.data.length === expected.data.length, 'dataset case count differs')
  for (let caseIndex = 0; caseIndex < expected.data.length; caseIndex += 1) {
    const actualKeys = Object.keys(actual.data[caseIndex]).sort()
    const expectedKeys = Object.keys(expected.data[caseIndex]).sort()
    assert(
      JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
      `dataset fields differ in case ${caseIndex}`,
    )
    for (const key of expectedKeys) {
      assertNumberArrayClose(
        actual.data[caseIndex][key],
        expected.data[caseIndex][key],
        tolerances.coefficients,
        `dataset[${caseIndex}].${key}`,
      )
    }
  }
}

export function assertFixtureShape(fixtures) {
  assert(fixtures?.schemaVersion === 1, 'unsupported fixture schema')
  assert(fixtures?.oracle?.engine === 'Pyodide', 'fixture oracle is not Pyodide')
  for (const collection of ['designs', 'stages', 'datasets']) {
    assert(Array.isArray(fixtures[collection]), `${collection} is not an array`)
    const ids = new Set()
    for (const testCase of fixtures[collection]) {
      assert(typeof testCase.id === 'string' && testCase.id.length > 0, `${collection} case has no id`)
      assert(!ids.has(testCase.id), `duplicate ${collection} id ${testCase.id}`)
      ids.add(testCase.id)
      assert(typeof testCase.outcome?.ok === 'boolean', `${testCase.id} has no outcome`)
    }
  }
}
