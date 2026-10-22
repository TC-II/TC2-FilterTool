// Plotly shape helpers.

/**
 * A filled dot of fixed pixel radius, anchored at data coordinates (x, y).
 *
 * Not a `circle` shape: on a log axis Plotly runs x0/x1 through log10 even in
 * pixel sizemode, log10(-r) is NaN, and the dot comes out as a squashed,
 * offset ellipse. Path coordinates are not converted: they are pixel offsets
 * from xanchor / yanchor (y pointing up). Paths have no arc command, so the
 * circle is four cubic Béziers.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} r radius in px
 * @param {object} [style] extra shape props (fillcolor, line, ...)
 */
export function pixelDot(x, y, r, style = {}) {
  const k = +(0.5523 * r).toFixed(3)
  const path =
    `M ${r},0 C ${r},${k} ${k},${r} 0,${r} C ${-k},${r} ${-r},${k} ${-r},0 ` +
    `C ${-r},${-k} ${-k},${-r} 0,${-r} C ${k},${-r} ${r},${-k} ${r},0 Z`
  return {
    type: 'path', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
    xanchor: x, yanchor: y, path, ...style,
  }
}
