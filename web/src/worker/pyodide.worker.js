import { expose } from 'comlink'

const PYODIDE_VERSION = '0.27.5'
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

const PYTHON_FILES = [
  'Filter.py',
  'transfer_function.py',
  'Dataset.py',
  'Dataline.py',
  'Parser.py',
  'CellCalculator.py',
  'calculusRauchBPass.py',
  'chevisheII.py',
  '__init__.py',
]

let pyodide = null

async function loadPythonFiles(baseUrl) {
  pyodide.FS.mkdir('/python')
  await Promise.all(
    PYTHON_FILES.map(async (filename) => {
      const res = await fetch(`${baseUrl}python/${filename}`)
      if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`)
      const text = await res.text()
      pyodide.FS.writeFile(`/python/${filename}`, text)
    })
  )
}

const api = {
  async init(baseUrl, onProgress) {
    // Fire-and-forget helper — comlink proxies return Promises but we don't
    // need to await progress updates; they are best-effort.
    const report = (pct, status) => { if (onProgress) onProgress(pct, status) }

    report(5, 'Loading Python runtime…')

    const { loadPyodide } = await import(
      /* @vite-ignore */
      `${PYODIDE_CDN}pyodide.mjs`
    )

    pyodide = await loadPyodide({ indexURL: PYODIDE_CDN })
    report(30, 'Loading packages…')

    // Count "Loaded X" messages to drive 30→78 % of the bar.
    // numpy+scipy+sympy pull in ~20 transitive packages; cap at that.
    const EXPECTED = 20
    let loaded = 0
    await pyodide.loadPackage(['numpy', 'scipy', 'sympy', 'micropip'], {
      messageCallback(msg) {
        if (msg.startsWith('Loaded ')) {
          loaded++
          const pct = 30 + Math.min(loaded / EXPECTED, 1) * 48
          report(pct, msg.slice(7))   // strip "Loaded " prefix
        }
      },
    })
    report(78, 'Loading project files…')

    await loadPythonFiles(baseUrl)
    report(92, 'Initializing…')

    pyodide.runPython(`
import sys
sys.path.insert(0, '/python')
import json, numpy as np
from Filter import AnalogFilter
from transfer_function import TFunction
`)

    return true
  },

  // params mirrors AnalogFilter(**kwargs) constructor fields.
  // Required: filter_type, approx_type, N_min, N_max, ap_dB, aa_dB, wp, wa
  // For BP/BR also: w0, bw, define_with
  async filterDesign(params) {
    pyodide.globals.set('_params_json', JSON.stringify(params))
    const result = pyodide.runPython(`
params = json.loads(_params_json)
f = AnalogFilter(**params)
valid, msg = f.validate()
if not valid:
    _result = json.dumps({'error': msg})
else:
    z, p = f.tf.getZP()
    num, den = f.tf.getND()
    _result = json.dumps({
        'zeros': [[float(x.real), float(x.imag)] for x in z],
        'poles': [[float(x.real), float(x.imag)] for x in p],
        'num':   [float(x) for x in num],
        'den':   [float(x) for x in den],
        'gain':  float(f.tf.gain),
        'N':     int(f.N),
    })
_result
`)
    return JSON.parse(result)
  },

  // freqMinHz / freqMaxHz in Hz (not rad/s)
  async computeBode(num, den, freqMinHz = 0.1, freqMaxHz = 1e5, numPoints = 2000) {
    pyodide.globals.set('_num', pyodide.toPy(num))
    pyodide.globals.set('_den', pyodide.toPy(den))
    const result = pyodide.runPython(`
import numpy as _np
tf    = TFunction(list(_num), list(_den))
start = _np.log10(${freqMinHz})
stop  = _np.log10(${freqMaxHz})
f, g, ph, gd = tf.getBode(start=start, stop=stop, num=${numPoints})
json.dumps({
    'freq':       f.tolist(),
    'magnitude':  g.tolist(),
    'phase':      ph.tolist(),
    'groupDelay': gd.tolist(),
})
`)
    return JSON.parse(result)
  },

  // zeros/poles: [[real, imag], ...], gain: number
  // normtype: 'Passband'|'ω→0'|'ω→∞'|'ω→ω0'  filterType: 0=LP 1=HP 2=BP 3=BR
  async buildStageFromZPK(zeros, poles, gain, normtype = 'Passband', filterType = 0) {
    pyodide.globals.set('_z', pyodide.toPy(zeros.map(([r, i]) => [r, i])))
    pyodide.globals.set('_p', pyodide.toPy(poles.map(([r, i]) => [r, i])))
    pyodide.globals.set('_k', gain)
    pyodide.globals.set('_normtype', normtype)
    pyodide.globals.set('_filter_type', filterType)
    const result = pyodide.runPython(`
z_c = [complex(r, i) for r, i in _z]
p_c = [complex(r, i) for r, i in _p]

nt = _normtype
# Resolve 'Passband' to the canonical norm for the filter type
if nt == 'Passband':
    if _filter_type == 1:    # HP
        nt = 'ω→∞'
    elif _filter_type == 2:  # BP
        nt = 'ω→ω0'
    else:                    # LP, BR, GD
        nt = 'ω→0'

if nt == 'ω→0':
    # H(0) = 1: norm_gain = prod(poles≠0) / prod(zeros≠0)
    pnz = [p for p in p_c if not np.isclose(abs(p), 0, atol=1e-5)]
    znz = [z for z in z_c if not np.isclose(abs(z), 0, atol=1e-5)]
    pProd = np.prod(pnz) if pnz else 1
    zProd = np.prod(znz) if znz else 1
    norm_gain = float(np.abs(pProd / zProd)) if zProd != 0 else float(np.abs(pProd))
elif nt == 'ω→∞':
    norm_gain = 1.0
elif nt == 'ω→ω0':
    temp_tf = TFunction(z_c, p_c, 1, normalize=False)
    w0 = float(np.abs(p_c[0]))
    val = temp_tf.at(w0 * 1j)
    norm_gain = float(1.0 / np.abs(val)) if np.abs(val) > 1e-12 else 1.0
else:
    norm_gain = 1.0

tf  = TFunction(z_c, p_c, norm_gain * _k, normalize=False)
num, den = tf.getND()
json.dumps({
    'num':  [float(x) for x in num],
    'den':  [float(x) for x in den],
    'gain': float(norm_gain * _k),
})
`)
    return JSON.parse(result)
  },

  // fileText: string content of the file; filename: original filename (for extension/brand detection)
  async parseDataset(fileText, filename) {
    pyodide.globals.set('_file_text', fileText)
    pyodide.globals.set('_filename', filename)
    const result = pyodide.runPython(`
filepath = '/tmp/' + _filename
with open(filepath, 'w') as _f:
    _f.write(_file_text)
from Dataset import Dataset
ds = Dataset(filepath)
json.dumps({
    'fields':           ds.fields,
    'cases':            len(ds.data),
    'casenames':        ds.casenames,
    'suggestedXsource': ds.suggestedXsource,
    'suggestedYsource': ds.suggestedYsource,
    'suggestedXscale':  float(ds.suggestedXscale),
    'suggestedYscale':  float(ds.suggestedYscale),
    'miscinfo':         ds.miscinfo,
    'data': [
        {k: [complex(x).real for x in v] for k, v in case.items()}
        for case in ds.data
    ],
})
`)
    return JSON.parse(result)
  },
}

expose(api)
