import scipy as sp
import numpy as np

c1 = 1e-9
c2 = 1e-9
r8 = 1000

# da = 1100
# dp = 10e3
# fo = 44e3
# Aa = 48
# Ap = 6

da = 1100
dp = 10e3
fo = 44.3e3
Aa = 48
Ap = 6
nMax = 2

wpMin = (-dp + np.sqrt(dp**2 + 4*fo**2))*np.pi
wpMax = (dp + np.sqrt(dp**2 + 4*fo**2))*np.pi
waMin = (-da + np.sqrt(da**2 + 4*fo**2))*np.pi
waMax = (da + np.sqrt(da**2 + 4*fo**2))*np.pi

n, Wn= sp.signal.cheb2ord([wpMin,wpMax], [waMin,waMax], Ap, Aa, analog=True)
z, p, k = sp.signal.cheby2(n, Aa, Wn, 'stop', analog=True, output = 'zpk')
sos = sp.signal.cheby2(n, Aa, Wn, 'stop', analog=True, output = 'sos')

if n > nMax:
    print('Max Order exceeded', end = '\n\n\n')

else:
    print ('fo =', fo/1000, 'K Hz', '   dp =', dp, 'Hz', '    da =', da/1000, 'K Hz', '   Aa =', Aa, '   Ap =', Ap)
    print ('Order:', n)
    print ('Wn:', Wn/1000, 'K rad/s')
    print ('fn:', Wn/(2*np.pi*1000), 'K Hz', end = '\n\n\n')
    for i in range(n):
        print ('Stage:', i + 1)
        m = sos[i][0]
        c = sos[i][1]
        d = sos[i][2]
        l = sos[i][3]
        a = sos[i][4]
        b = sos[i][5]
        print ('m =', m, '  c =', c, '    d =', d)
        print ('? =', l, '  a =', a, '  b =', b)
        wz = np.sqrt(d/m)
        print ('wz:', wz/1000, 'K rad/s')
        print ('fz:', wz/(2*np.pi*1000), 'K Hz')
        wp = np.sqrt(b)
        print ('wp:', wp/1000, 'K rad/s')
        print ('fp:', wp/(2*np.pi*1000), 'K Hz')
        q = np.sqrt(b)/a
        print('Q:', q, end = '\n\n')
        r1 = 1/(a*c1)
        print('R1:', r1)
        r2 = 1/(np.sqrt(b)*c2)
        print('R2:', r2)
        r3 = 1/(np.sqrt(b)*c1)
        print('R3:', r3)
        r4 = 1/(m*a*c1)
        print('R4:', r4)
        r5 = np.sqrt(b)/(d*c2)
        print('R5:', r5)
        r6 = r8/m
        print('R6:', r6)
        r7 = r8
        print('R7:', r7)
        print('R8:', r8)
        print('C2:', c1*1e9, 'nF')
        print('C1:', c2*1e9, 'nF', end = '\n\n')
        print('.param R1A =', r1)
        print('.param R2A =', r2)
        print('.param R5A =', r5, end = '\n\n\n\n')