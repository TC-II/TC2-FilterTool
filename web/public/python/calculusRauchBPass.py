import numpy as np
from scipy import signal
from sympy import symbols, Eq, solve
from enum import Enum

# Diseño
fo = 4.0e3/3.0
qo = 7.0
order = 2
ap = 0.1

print("\nCondiciones de diseño: -- fo = ", fo,
      "-- Q = ", qo, "-- n = ", order, "-- Ap = ", ap)

# Cálculo de omegas + y - según el ancho de banda
x, y = symbols('x, y')
eq1 = Eq(fo**2, x*y)
eq2 = Eq(fo/qo, x - y)
sol = solve((eq1, eq2), (x, y))
fplus = sol[1][0]
fminus = sol[1][1]
wplus = fplus * 2.0 * np.pi
wminus = fminus * 2.0 * np.pi
stages = signal.cheby1(order, ap, [float(wminus), float(
    wplus)], 'bandpass', analog=True, output='sos')

gain = stages[0][2]

w_0 = np.sqrt(stages[0][5])
q_0 = w_0/stages[0][4]
gain *= q_0                 # Ajuste por acomodar expresión
gain /= w_0                 # Ajuste por acomodar expresión
print("\nEtapa 0: ", "w = ", w_0, "--- Q = ", q_0)

w_1 = np.sqrt(stages[1][5])
q_1 = w_1/stages[1][4]
gain *= q_1                 # Ajuste por acomodar expresión
gain /= w_1                 # Ajuste por acomodar expresión
print("Etapa 1: ", "w = ", w_1, "--- Q = ", q_1)

gain *= np.sqrt(10)         # Se agregan 10dB

print("Ganancia total: ", gain)

# Variables~parámetros para cálculo de cada celda
wcero, qsim, alpha, qreal, K, H, HB, C, R2, R1, R1a, R1b, a, Rpot, RpotH, RpotL = symbols(
    'wcero, qsim, alpha, qreal, K, H, HB, C, R2, R1, R1a, R1b, a, Rpot, RpotH, RpotL')

# Valores independientes de la celda
eq3 = Eq(qsim, 1.5)
eqa = Eq(Rpot, 10e3)
eqb = Eq(R1a, 100e3)
eqc = Eq(wcero, w_1)
eqd = Eq(HB, np.sqrt(gain))
eqe = Eq(qreal, q_1)

# Valores dependientes de la celda
eq4 = Eq(alpha, (1/(2*qsim*qsim))*(1-qsim/qreal))
eq5 = Eq(K, alpha/(1+alpha))
eq6 = Eq(H, HB*qsim*(1-K)/qreal)
eq7 = Eq(R2, 2*qsim*1/(wcero * C))
eq8 = Eq(R1, R2/(4*qsim*qsim))
eq9 = Eq(a, H/(2*qsim*qsim))
eq10 = Eq(R1a, R1/a)
eq11 = Eq(R1b, R1/(1-a))
eq12 = Eq(RpotH, (1-K)*Rpot)
eq13 = Eq(RpotL, K*Rpot)

solution = solve((eq3, eqa, eqb, eqc, eqd, eqe, eq4, eq5, eq6, eq7, eq8, eq9, eq10, eq11, eq12, eq13),
                 (wcero, qsim, alpha, qreal, K, H, HB, C, R2, R1, R1a, R1b, a, Rpot, RpotH, RpotL))

solution = list(solution[0])

# print("\nSoluciones 1er etapa:\n")
print(".param R1a_1 ", solution[10],
      "\n.param R1b_1 ", solution[11],
      "\n.param R2_1 ", solution[8],
      "\n.param C_1 ", solution[7],
      "\n.param RpotH_1 ", solution[14],
      "\n.param RpotL_1 ", solution[15])

# Valores independientes de la celda
eq3 = Eq(qsim, 1.5)
eqa = Eq(Rpot, 10e3)
eqb = Eq(R1a, 100e3)
eqc = Eq(wcero, w_0)
eqd = Eq(HB, np.sqrt(gain))
eqe = Eq(qreal, q_0)

# Valores dependientes de la celda
eq4 = Eq(alpha, (1/(2*qsim*qsim))*(1-qsim/qreal))
eq5 = Eq(K, alpha/(1+alpha))
eq6 = Eq(H, HB*qsim*(1-K)/qreal)
eq7 = Eq(R2, 2*qsim*1/(wcero * C))
eq8 = Eq(R1, R2/(4*qsim*qsim))
eq9 = Eq(a, H/(2*qsim*qsim))
eq10 = Eq(R1a, R1/a)
eq11 = Eq(R1b, R1/(1-a))
eq12 = Eq(RpotH, (1-K)*Rpot)
eq13 = Eq(RpotL, K*Rpot)

solution = solve((eq3, eqa, eqb, eqc, eqd, eqe, eq4, eq5, eq6, eq7, eq8, eq9, eq10, eq11, eq12, eq13),
                 (wcero, qsim, alpha, qreal, K, H, HB, C, R2, R1, R1a, R1b, a, Rpot, RpotH, RpotL))

solution = list(solution[0])

# print("\nSoluciones 2da etapa:\n")
print(".param R1a_2 ", solution[10],
      "\n.param R1b_2 ", solution[11],
      "\n.param R2_2 ", solution[8],
      "\n.param C_2 ", solution[7],
      "\n.param RpotH_2 ", solution[14],
      "\n.param RpotL_2 ", solution[15])

# b, a = signal.cheby1(4, 5, 100, 'low', analog=True)
# b, a = signal.cheby1(2, 0.5, [7800.5255, 8997.3228], 'bandpass', analog=True)
# w, h = signal.freqs(b, a)

# plt.semilogx(w/(2*np.pi), 20 * np.log10(abs(h)))
# plt.margins(0, 0.1)
# plt.grid(which='both', axis='both')
# plt.axvline(4e3/3, color='green') # cutoff frequency
# plt.axhline(-0.5, color='green') # rp
# plt.xlim([1e3,1900])
# plt.ylim([-40,15])
# plt.show()
