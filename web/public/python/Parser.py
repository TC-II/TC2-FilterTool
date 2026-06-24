import sympy as sym
from sympy import Symbol, S, oo

s = sym.symbols('s')

#Puntaje asignado a la complejidad para la simplificación de sympy
def determinar_complejidad(expr):
    DIV = Symbol('/')
    count = sym.count_ops(expr, visual=True).subs(DIV, 100000) #penalizo fuertemente las divisiones
    count = count.replace(Symbol, type(S.One)) #A todo lo demás le doy un 1
    return count

class ExprParser():
    def __init__(self, txt='', expr = None, *args):
      self.symEx = None
      self.fractionEx = None
      self.txt = ''
      if txt != '':
        self.setTxt(txt)
      if expr != None:
        self.setExpression(expr)

    def applyFactor(self, factor):
      symEx = symEx * factor
      # self.simplify()

    def setTxt(self, txt):
      self.txt = txt
      self.symEx = sym.parsing.sympy_parser.parse_expr(txt, transformations = 'all')
      self.simplify()

    def setExpression(self, expr):
      self.symEx = expr
      self.simplify()

    def simplify(self):
      self.symEx = sym.cancel(self.symEx) # sym.simplify(self.symEx, ratio=oo, measure=determinar_complejidad)
      self.fractionEx = sym.fraction(self.symEx)

    def transform(self, transformation):
      self.symEx = self.symEx.subs(s, transformation)
      self.simplify()

    def getND(self):
      N = sym.Poly(self.fractionEx[0]).all_coeffs() if (s in self.fractionEx[0].free_symbols) else [self.fractionEx[0].evalf()]
      D = sym.Poly(self.fractionEx[1]).all_coeffs() if (s in self.fractionEx[1].free_symbols) else [self.fractionEx[1].evalf()]
      return N, D

    def getLatex(self, txt=None):
      if not txt:
        return sym.latex(sym.sympify(self.txt))
      else:
        return sym.latex(sym.sympify(txt))
      
    def getSympyfied(self, txt=None):
      if not txt:
        return sym.sympify(self.txt)
      else:
        return sym.sympify(txt)