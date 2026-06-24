from inspect import trace
import sys
import traceback
from transfer_function import TFunction
import scipy.signal as signal
import numpy as np
from numpy.polynomial import Polynomial
from numpy.polynomial import Legendre
import sympy as sym
from Parser import ExprParser
import traceback
pi = np.pi

MAX_ORDER = 50
LOW_PASS, HIGH_PASS, BAND_PASS, BAND_REJECT, GROUP_DELAY = range(5)
BUTTERWORTH, CHEBYSHEV, CHEBYSHEV2, CAUER, LEGENDRE, BESSEL, GAUSS, APPRX_NONE = range(8)
TEMPLATE_FREQS, F0_BW = range(2)

NORM_CB_PB = 'Passband'
NORM_CB_DC = 'ω→0'
NORM_CB_HF = 'ω→∞'
NORM_CB_BP = 'ω→ω0'


def get_Leps(n, eps):
    k = int(n / 2 - 1) if (n % 2 == 0) else int((n - 1) / 2)
        
    a = []
    for i in range(k + 1):
        if n % 2 == 0:
            if k % 2 == 0:
                if i == 0:
                    a.append(1 / (np.sqrt(((k + 1) * (k + 2)))))
                elif i % 2 == 0:
                    a.append((2 * i + 1) * a[0])
                else:
                    a.append(0)
            else:
                if i == 1:
                    a.append(3 / (np.sqrt((k + 1) * (k + 2))))
                elif i % 2 == 0:
                    a.append(0)
                else:
                    a.append((2 * i + 1) * a[1] / 3)
        else:
            if i == 0:
                a.append(1 / (np.sqrt(2) * (k + 1)))
            else:
                a.append((2 * i + 1) * a[0])
    
    sum_prod_pol = Legendre(a).convert(kind=Polynomial)
    sum_prod_pol **= 2
    if n % 2 == 0:
        sum_prod_pol *= Polynomial([1, 1]) #multiplico por 1+x
    
    sum_prod_pol = sum_prod_pol.integ() # primitiva
    sum_prod_pol = sum_prod_pol(Polynomial([-1, 0, 2])) - sum_prod_pol(-1) # evalúo
    return Polynomial([1]) + sum_prod_pol*eps*eps

def select_roots(p):
    roots = p.roots()*(-1j) #vuelvo desde w al dominio de s
    valid_roots = []
    for root in roots:
        if root.real <= 0:
            valid_roots.append(root)
    return valid_roots

def is_conjugate(z1, z2):
    return np.isclose(np.imag(z1), -np.imag(z2), rtol=1e-5)

def is_complex(z):
    return not np.isclose(np.imag(z), 0, rtol=1e-5)

def is_equal(z1, z2):
    return abs(np.real(z1) - np.real(z2)) + abs(np.imag(z1) - np.imag(z2)) < 1e-5

def approx_to_str(apprind):
    if(apprind == BUTTERWORTH):
        return "Butterworth"
    elif(apprind == CHEBYSHEV):
        return "Chebyshev I"
    elif(apprind == CHEBYSHEV2):
        return "Chebyshev II"
    elif(apprind == CAUER):
        return "Cauer"
    elif(apprind == LEGENDRE):
        return "Legendre"
    elif(apprind == BESSEL):
        return "Bessel"
    elif(apprind == GAUSS):
        return "Gauss"
    elif(apprind == APPRX_NONE):
        return "None"
    return "None"


class AnalogFilter():
    def __init__(self, **kwargs):
        self.tf = {}
        self.tf_norm = {}
        self.tf_template = {}
        for k, v in kwargs.items():
            setattr(self, k, v) #Seteo todos los atributos de 1
        self.stages = []
        self.implemented_tf = {}
        self.remainingZeros = []
        self.remainingPoles = []
        self.remainingGain = np.nan
        self.actualGain = np.nan
        self.eparser = ExprParser()
        self.helperFilters = []
        self.helperLabels = []
        self.reqwa = 0
        self.reqwp = 0
        
    def __str__(self):
        return "{} - orden {}".format(approx_to_str(self.approx_type), self.N)

    def validate(self):
        self.gp_dB = -self.ap_dB
        self.ga_dB = -self.aa_dB
        self.reqwa = [-1, -1]
        self.reqwp = [-1, -1]
        try:
            assert self.N_max <= MAX_ORDER
            assert self.N_min >= 1
            assert self.N_min <= self.N_max

            if self.filter_type == LOW_PASS:
                assert self.gp_dB > self.ga_dB
                assert self.wp < self.wa

            if self.filter_type == HIGH_PASS:
                assert self.gp_dB > self.ga_dB
                assert self.wp > self.wa

            if self.filter_type == BAND_PASS:
                self.reqwa = self.wa[:]
                assert self.gp_dB > self.ga_dB 
                if self.define_with == TEMPLATE_FREQS:
                    assert self.wa[0] < self.wp[0]
                    assert self.wp[0] < self.wp[1]
                    assert self.wp[1] < self.wa[1]
                    self.w0 = np.sqrt(self.wp[0]*self.wp[1]) # me quedo con las frecuencias centrales
                    self.bw[0] = self.wp[1] - self.wp[0] # y los anchos de banda
                    if(self.wa[0]*self.wa[1] != self.w0**2):
                        wamincalc = self.w0**2/self.wa[1]
                        wamaxcalc = self.w0**2/self.wa[0]
                        if(wamincalc > self.wa[0]):
                            # mas restrictiva hacia abajo
                            self.wa[0] = wamincalc
                        elif(wamaxcalc < self.wa[1]):
                            # mas restrictiva hacia arriba
                            self.wa[1] = wamaxcalc
                        else:
                            print("WTF")
                    self.bw[1] = self.wa[1] - self.wa[0]
                elif self.define_with == F0_BW:
                    assert self.bw[0] < self.bw[1]
                    Qp = self.w0 / self.bw[0]
                    Qa = self.w0 / self.bw[1]
                    self.wp[0] = self.w0 * (np.sqrt(1 + 1 / (4 * (Qp**2))) - 1 / (2 * Qp))
                    self.wp[1] = self.w0 * (np.sqrt(1 + 1 / (4 * (Qp**2))) + 1 / (2 * Qp))
                    self.wa[0] = self.w0 * (np.sqrt(1 + 1 / (4 * (Qa**2))) - 1 / (2 * Qa))
                    self.wa[1] = self.w0 * (np.sqrt(1 + 1 / (4 * (Qa**2))) + 1 / (2 * Qa))

            if self.filter_type == BAND_REJECT:
                self.reqwp = self.wp[:]
                assert self.gp_dB > self.ga_dB 
                if self.define_with == TEMPLATE_FREQS:
                    assert self.wp[0] < self.wa[0]
                    assert self.wa[0] < self.wa[1]
                    assert self.wa[1] < self.wp[1]
                    self.w0 = np.sqrt(self.wa[0]*self.wa[1]) # me quedo con las frecuencias centrales
                    self.bw[0] = self.wa[1] - self.wa[0] # y los anchos de banda
                    if(self.wp[0]*self.wp[1] != self.w0**2):
                        wpmincalc = self.w0**2/self.wp[1]
                        wpmaxcalc = self.w0**2/self.wp[0]
                        if(wpmincalc > self.wp[0]):
                            # mas restrictiva hacia abajo
                            self.wp[0] = wpmincalc
                        elif(wpmaxcalc < self.wp[1]):
                            # mas restrictiva hacia arriba
                            self.wp[1] = wpmaxcalc
                        else:
                            print("WTF")
                    self.bw[1] = self.wp[1] - self.wp[0]
                elif self.define_with == F0_BW:
                    assert self.bw[0] < self.bw[1]
                    self.wa[0] = 0.5 * (-self.bw[0] + np.sqrt(self.bw[0]**2 + 4*(self.w0**2))) #defino las frecuencias centrales a partir del ancho de banda
                    self.wa[1] = self.wa[0] + self.bw[0]
                    self.wp[0] = 0.5 * (-self.bw[1] + np.sqrt(self.bw[1]**2 + 4*(self.w0**2))) #defino las frecuencias de afuera tal que haya simetría geométrica
                    self.wp[1] = self.wp[0] + self.bw[1]

            if self.filter_type == GROUP_DELAY:
                assert self.gamma > 0 and self.gamma < 100
                assert self.tau0 > 0
                assert self.wrg > 0
            # traceback.print_stack(limit=4)
            self.compute_normalized_parameters(init=True)
            self.tf = None
            self.tf_norm = None
            self.get_tf_norm()
            assert self.tf_norm
            self.compute_denormalized_parameters()
            self.resetStages()
            if(not self.is_helper):
                self.addHelperFilters()
            # traceback.print_stack(limit=4)
            
        except:
            a, err, tb = sys.exc_info()
            tb_info = traceback.extract_tb(tb)
            err_msg = ''
            for tb_item in tb_info:
                err_msg += tb_item.filename + ' - ' + tb_item.line + '\n'
            err_msg += str(a) + ' ' + str(err) + '\n'
            print(err_msg)
            return False, err_msg
        return True, "OK"

    def get_tf_norm(self):     
        if self.approx_type == BUTTERWORTH:
            self.N, self.wc = signal.buttord(1, self.wan, self.ap_dB, self.aa_dB, analog=True)
            if(self.N > self.N_max):
                self.N = self.N_max
            if self.N < self.N_min:
                self.N = self.N_min
            N, D = signal.butter(self.N, self.wc, analog=True, output='ba')
            z, p, k = signal.butter(self.N, self.wc, analog=True, output='zpk')
            self.tf_norm = TFunction(z, p, k, N, D)

        elif self.approx_type == CHEBYSHEV:
            self.N, self.wc = signal.cheb1ord(1, self.wan, self.ap_dB, self.aa_dB, analog=True)
            if(self.N > self.N_max):
                self.N = self.N_max
            if self.N < self.N_min:
                self.N = self.N_min
            N, D = signal.cheby1(self.N, self.ap_dB, self.wc, analog=True, output='ba')
            z, p, k = signal.cheby1(self.N, self.ap_dB, self.wc, analog=True, output='zpk')
            self.tf_norm = TFunction(z, p, k, N, D)

        elif self.approx_type == CHEBYSHEV2:
            self.N, self.wc = signal.cheb2ord(1, self.wan, self.ap_dB, self.aa_dB, analog=True)
            if(self.N > self.N_max):
                self.N = self.N_max
            if self.N < self.N_min:
                self.N = self.N_min
            N, D = signal.cheby2(self.N, self.aa_dB, self.wc, analog=True, output='ba')
            z, p, k = signal.cheby2(self.N, self.aa_dB, self.wc, analog=True, output='zpk')
            self.tf_norm = TFunction(z, p, k, N, D)
        
        elif self.approx_type == CAUER:
            self.N, self.wc = signal.ellipord(1, self.wan, self.ap_dB, self.aa_dB, analog=True)
            if(self.N > self.N_max):
                self.N = self.N_max
            if self.N < self.N_min:
                self.N = self.N_min
            N, D = signal.ellip(self.N, self.ap_dB, self.aa_dB, self.wc, analog=True, output='ba')
            z, p, k = signal.ellip(self.N, self.ap_dB, self.aa_dB, self.wc, analog=True, output='zpk')
            self.tf_norm = TFunction(z, p, k, N, D)
        
        elif self.approx_type == LEGENDRE:
            self.N = self.N_min
            # eps == xi
            eps = np.sqrt(((10 ** (-0.1 * self.gp_dB)) - 1))
            
            while True:
                L_eps = get_Leps(self.N, eps)
                z = []
                p = select_roots(L_eps)
                p0 = np.prod(p) * (1 if self.N % 2 == 0 else -1) #en N tengo N polos y yo quiero obtener el producto de los polos negados para normalizar
                tf2 = TFunction(z, p, p0)
                
                tf2_wmax = abs(tf2.at(self.wan))
                # print(self.N, tf2_wmin >= self.gp, tf2_wmax <= self.ga, tf2_wmin, tf2_wmax)
                if(self.N == self.N_max or tf2_wmax <= self.ga):
                    self.tf_norm = TFunction(z, p, p0)
                    break
                self.N += 1
        
        elif self.approx_type == BESSEL:
            s = sym.symbols('s')
            self.N = self.N_min
            while True:
                if(self.filter_type == GROUP_DELAY):
                    N, D = signal.bessel(self.N, 1, analog=True, output='ba', norm='delay') #produce un delay de 1/1 seg (cambiar el segundo parámetro)
                    z, p, k = signal.bessel(self.N, 1, analog=True, output='zpk', norm='delay')
                    tf2 = TFunction(z, p, k, N, D)
                    if(self.N == self.N_max or (1 - tf2.gd_at(self.wrg_n) <= self.gamma/100)): #si el gd es menor-igual que el esperado, estamos
                        self.tf_norm = TFunction(z, p, k, N, D)
                        break
                else:
                    N, D = signal.bessel(self.N, 1, analog=True, output='ba') #produce un delay de 1/1 seg (cambiar el segundo parámetro)
                    self.eparser.setExpression(sym.Poly(N, s)/sym.Poly(D, s))
                    z, p, k = signal.bessel(self.N, 1, analog=True, output='zpk')
                    tf2 = TFunction(z, p, k, N, D)
                    w, g, ph = tf2.getBodeMagFast(linear=False, start=np.log10(1/(30*self.wan*2*pi)), stop=np.log10(5*self.wan/(2*pi)), num=100, use_hz=False)
                    wd = np.nan
                    wr = w[::-1]
                    gr = g[::-1]
                    for i, wi in enumerate(wr):
                        if (gr[i] > self.gp):
                            wint, gint, ph = tf2.getBodeMagFast(linear=False, start=np.log10(wr[i+1]), stop=np.log10(wr[i-1]), num=500, use_hz=False)
                            wrint = wint[::-1]
                            grint = gint[::-1]
                            for ii, wi2 in enumerate(wrint):
                                if (grint[ii] >= self.gp):
                                    wd = wi2
                                    break
                            if(not np.isnan(wd)):
                                break
                    assert not np.isnan(wd)
                    
                    transformation = s * wd
                    self.eparser.transform(transformation)
                    N, D = self.eparser.getND()
                    tf3 = TFunction(N, D)
                    if(self.N == self.N_max or np.abs(tf3.at(self.wan)) <= self.ga):
                        self.tf_norm = tf3
                        break
                self.N += 1

        elif self.approx_type == GAUSS:
            s = sym.symbols('s')
            self.N = 1
            
            gauss_poly = [1, 0, 1] # producirá un delay de 1 segundo
            fact_prod = 1
            
            while True:
                if self.N >= self.N_min:
                    p = select_roots(Polynomial(gauss_poly))
                    p0 = np.prod(p)
                    tf2 = TFunction([], p, p0)
                    
                    if(self.filter_type == GROUP_DELAY):
                        g0 = tf2.gd_at(0)                       
                        p = [r * g0 for r in p]
                        tf2 = TFunction([], p, p0)
                        if(self.N == self.N_max or (1 - tf2.gd_at(self.wrg_n) <= self.gamma/100)): #si el gd es menor-igual que el esperado, estamos
                            p0 = np.prod(p)
                            self.tf_norm = TFunction([], p, p0)
                            break
                    else:
                        w, g, ph = tf2.getBodeMagFast(linear=False, start=np.log10(1/(10*self.wan*2*pi)), stop=np.log10(5*self.wan/(2*pi)), num=100, use_hz=False)
                        wd = np.nan
                        wr = w[::-1]
                        gr = g[::-1]
                        for i, wi in enumerate(wr):
                            if (gr[i] > self.gp):
                                wint, gint, ph = tf2.getBodeMagFast(linear=False, start=np.log10(wr[i+1]), stop=np.log10(wr[i-1]), num=500, use_hz=False)
                                wrint = wint[::-1]
                                grint = gint[::-1]
                                for ii, wi2 in enumerate(wrint):
                                    if (grint[ii] >= self.gp):
                                        wd = wi2
                                        break
                                if(not np.isnan(wd)):
                                    break
                        assert not np.isnan(wd)
                        self.eparser.setExpression(sym.Poly(tf2.N, s)/sym.Poly(tf2.D, s))
                        transformation = s * wd
                        self.eparser.transform(transformation)
                        N, D = self.eparser.getND()
                        tf3 = TFunction(N, D)
                        if(self.N == self.N_max or np.abs(tf3.at(self.wan)) <= self.ga):
                            self.tf_norm = tf3
                            break
                self.N += 1
                fact_prod *= self.N
                gauss_poly.append(0)
                gauss_poly.append(1/fact_prod)
    
    def compute_normalized_parameters(self, init=False):
        if self.filter_type < GROUP_DELAY:
            self.ga = np.power(10, (self.ga_dB / 20))
            self.gp = np.power(10, (self.gp_dB / 20))

            if self.filter_type == LOW_PASS:
                self.wan = self.wa / self.wp
            elif self.filter_type == HIGH_PASS:
                self.wan = self.wp / self.wa
            elif self.filter_type in [BAND_PASS, BAND_REJECT]:
                self.wan = self.bw[1] / self.bw[0]
        elif self.filter_type == GROUP_DELAY and init:
            self.wrg_n = self.wrg * self.tau0
        else:
            pass
    
    def compute_denormalized_parameters(self):
        s = sym.symbols('s')
        self.eparser.setExpression(sym.Poly(self.tf_norm.N, s)/sym.Poly(self.tf_norm.D, s))

        #Primera desnormalización: la elegida en las opciones
        if self.filter_type != GROUP_DELAY:
            w, g, ph = self.tf_norm.getBodeMagFast(linear=False, start=np.log10(1/(30*self.wan*2*pi)), stop=np.log10(30*self.wan/(2*pi)), num=100, use_hz=False)
            wd = np.nan
            wr = w[::-1]
            gr = g[::-1]
            denor = self.denorm/100
            for i, wi in enumerate(wr):
                if (gr[i] > self.ga):
                    wint, gint, ph = self.tf_norm.getBodeMagFast(linear=False, start=np.log10(wr[i+1]), stop=np.log10(wr[i-1]), num=2000, use_hz=False)
                    wrint = wint[::-1]
                    grint = gint[::-1]
                    for ii, wi2 in enumerate(wrint):
                        if (grint[ii] >= self.ga):
                            wd = wi2
                            break
                    if(not np.isnan(wd)):
                        break
            assert not np.isnan(wd)
            transformation = s * ((1 - denor) * self.wan + denor * wd)/self.wan
            if(self.approx_type == CHEBYSHEV2):
                for i, wi in enumerate(wr):
                    if (gr[i] > self.gp):
                        wint, gint, ph = self.tf_norm.getBodeMagFast(linear=False, start=np.log10(wr[i+1]), stop=np.log10(wr[i-1]), num=2000, use_hz=False)
                        wrint = wint[::-1]
                        grint = gint[::-1]
                        for ii, wi2 in enumerate(wrint):
                            if (grint[ii] >= self.gp):
                                wp = wi2
                                break
                        if(not np.isnan(wp)):
                            break
                assert not np.isnan(wp)
                transformation *= (denor + (1-denor)*wp)

            self.eparser.transform(transformation)
            N, D = self.eparser.getND()
            self.tf_norm = TFunction(N, D)

        #segunda desnormalización: según el tipo de filtro
        if self.filter_type == LOW_PASS:
            transformation = (s / self.wp)
        elif self.filter_type == HIGH_PASS:
            transformation = (self.wp / s)
        elif self.filter_type == GROUP_DELAY:
            transformation = (s * self.tau0)
        elif(self.filter_type in [BAND_PASS, BAND_REJECT]):
            denorm_z = []
            denorm_p = []
            pprod = 1
            zprod = 1
            pprod2 = 1
            zprod2 = 1
            c = np.power(self.w0, 2)
            zeros, poles = self.tf_norm.getZP()
            for z in zeros:                
                b = z*self.bw[0] if self.filter_type==BAND_PASS else self.bw[1]/z
                z1 = b/2 + np.sqrt(np.power(b/2,2) - c, dtype=np.complex128)
                z2 = b/2 - np.sqrt(np.power(b/2,2) - c, dtype=np.complex128)
                denorm_z += [z1, z2]
                zprod = zprod * z #Sospecho de problemas con el *= y /= para complejos
                zprod2 = zprod * z1 * z2
            for p in poles:
                b = p*self.bw[0] if self.filter_type==BAND_PASS else self.bw[1]/p
                p1 = b/2 + np.sqrt(np.power(b/2,2) - c, dtype=np.complex128)
                p2 = b/2 - np.sqrt(np.power(b/2,2) - c, dtype=np.complex128)
                denorm_p += [p1, p2]
                pprod = pprod * p
                pprod2 = pprod2 * p1 * p2
            orddiff = len(poles) - len(zeros)
            assert orddiff >= 0
            
            if(self.filter_type == BAND_PASS):
                denorm_z += [0]*orddiff
                k = self.bw[0]**orddiff * pprod / zprod
            else:
                denorm_z = np.append(denorm_z, [self.w0*1j, -self.w0*1j]*orddiff if orddiff > 0 else [])
                k = 1 # (self.w0**2)**-orddiff
                
            self.actualGain = self.gain
            if(self.N % 2 == 0 and self.approx_type in [CHEBYSHEV, CAUER]):
                k *= np.power(10, -self.ap_dB/20)    
                self.actualGain = np.power(10, -self.ap_dB/20) * self.gain
                
            k = np.abs(k)
            self.kbandpass = k*self.gain
            self.kbandpasscurr = k*self.gain
            self.tf = TFunction(denorm_z, denorm_p, k*self.gain)
            self.tf_template = TFunction(denorm_z, denorm_p, k)
            
            return
        self.eparser.transform(transformation)
        N, D = self.eparser.getND()
        self.tf = TFunction([a * self.gain for a in N], D)
        self.tf_template = TFunction(N, D)
        self.actualGain = self.gain
        if(self.N % 2 == 0 and self.approx_type in [CHEBYSHEV, CAUER]):
            self.actualGain = np.power(10, -self.ap_dB/20) * self.gain

    def resetStages(self):
        self.remainingGain = np.float64(self.actualGain)
        self.remainingk = self.tf.k
        # print("REMAINING K ", self.remainingk)
        self.remainingZeros = self.tf.z.tolist()
        self.remainingPoles = self.tf.p.tolist()
        self.stages = []
        self.implemented_tf = TFunction(1, 1, normalize=False)

    def addStage(self, z_arr, p_arr, gain, normtype, symdrl=False, force_gain=True, pz_in_hz=False):
        if(pz_in_hz):
            # Por problemas de precisión, tengo que buscar los polos originales haciendo la misma transformación exacta
            # que los que llegaron en Hz
            pindexes = []
            zindexes = []
            for p in p_arr:
                pindexes += [(self.tf.p / (2*np.pi)).tolist().index(p)]
            for z in z_arr:
                zindexes += [(self.tf.z / (2*np.pi)).tolist().index(z)]
            p_arr = [self.tf.p[i] for i in pindexes] / (2 * np.pi)
            z_arr = [self.tf.z[i] for i in zindexes] / (2 * np.pi)

        if len(z_arr) > 2 or len(p_arr) > 2 or len(p_arr) == 0 or len(z_arr) > len(p_arr):
            return False
        
        if is_complex(p_arr[0]) and (len(p_arr) < 2 or not is_conjugate(p_arr[0], p_arr[1])):
            return False
        if(len(z_arr) > 0):
            if is_complex(z_arr[0]) and (len(z_arr) < 2 or not is_conjugate(z_arr[0], z_arr[1])):
                return False

        newRemainingZeros = len(self.remainingZeros) - len(z_arr)
        newRemainingPoles = len(self.remainingPoles) - len(p_arr)

        if newRemainingZeros > newRemainingPoles:
            return False
        
        resultingGain = gain

        if(normtype == NORM_CB_PB):
            if(self.filter_type==LOW_PASS):
                normtype = NORM_CB_DC
            elif(self.filter_type==HIGH_PASS):
                normtype = NORM_CB_HF
            elif(self.filter_type==BAND_PASS):
                normtype = NORM_CB_BP
            else:
                normtype = NORM_CB_DC # BR normalizes to 0, for now
        
        if(normtype == NORM_CB_DC):
            norm_gain = np.prod([p for p in p_arr if not np.isclose(p, 0, atol=1e-5)]) / np.prod([z for z in z_arr if not np.isclose(z, 0, atol=1e-5)])
        elif(normtype == NORM_CB_HF):
            norm_gain = 1
        elif(normtype == NORM_CB_BP):
            temp_tf = TFunction(z_arr, p_arr, 1, normalize=False)
            norm_gain = 1/temp_tf.at(np.abs(p_arr[0]))

        
        newStage_tf = TFunction(z_arr, p_arr, norm_gain*resultingGain, normalize=False)
        if(force_gain and newRemainingZeros == 0 and newRemainingPoles == 0):
            val=0
            if(self.filter_type==LOW_PASS):
                val = newStage_tf.at(0) * self.implemented_tf.at(0)
            elif(self.filter_type==HIGH_PASS):
                val = newStage_tf.at(1e40) * self.implemented_tf.at(1e40)
            elif(self.filter_type==BAND_PASS):
                val = newStage_tf.at(self.w0) * self.implemented_tf.at(self.w0)
            elif(self.filter_type==BAND_REJECT):
                val = newStage_tf.at(0) * self.implemented_tf.at(0)
            val = np.abs(val)/self.gain
            if(self.N % 2 == 0 and self.approx_type in [CHEBYSHEV, CAUER]):
                val /= np.power(10, -self.ap_dB/20)
            resultingGain /= val
            newStage_tf.multiplyGain(1/val)            
        elif(symdrl):
            isReject, bp = self.getBandpassRange()
            temp_tf = TFunction(z_arr, p_arr, norm_gain, normalize=False)
            minGain, maxGain = temp_tf.getEdgeGainsInRange(isReject, bp, True)
            DRL_mean = (maxGain + minGain)/2
            resultingGain *= 10**(-DRL_mean / 20)
            print(minGain, maxGain, DRL_mean, 10**(DRL_mean / 20))
            newStage_tf = TFunction(z_arr, p_arr, norm_gain*resultingGain, normalize=False)
            
        # norm_gain *= gain
        self.remainingk /= newStage_tf.k
        self.remainingGain /= resultingGain
        if(force_gain):
            newStage_tf.gain = resultingGain

        if(self.filter_type == BAND_PASS):
            self.kbandpasscurr /= newStage_tf.k
        
        self.stages.append(newStage_tf)
        self.implemented_tf.appendStage(newStage_tf)
        # self.remainingGain /= gain
        for z in z_arr:
            self.remainingZeros.remove(z)
        for p in p_arr:
            self.remainingPoles.remove(p)
        return True
        

    def removeStage(self, i):
        self.implemented_tf.removeStage(self.stages[i])
        self.stages[i].denormalize()
        if(self.filter_type == BAND_PASS):
            self.kbandpasscurr *= self.stages[i].k
        self.remainingGain = self.remainingGain * np.real(self.stages[i].gain)
        self.remainingk *= self.stages[i].k
        zeros_to_delete = len(self.stages[i].z)
        add_list = []
        for sz in self.stages[i].z:
            for z in self.tf.z:
                if(zeros_to_delete > 0):
                    if(np.isclose(sz, z)):
                        add_list.append(z)
                        zeros_to_delete -= 1
        self.remainingZeros += add_list
        add_list = []
        for sp in self.stages[i].p:
            for p in self.tf.p:
                if(np.isclose(sp, p)):
                    add_list.append(p)
        self.remainingPoles += add_list
        self.stages.pop(i)

    def addHelperFilters(self):
        self.helperFilters = []
        for approx in self.helper_approx:
            params = {
                "filter_type": self.filter_type,
                "approx_type": approx,
                "define_with": self.define_with,
                "gain": self.gain,
                "is_helper": True,
                "denorm": self.denorm,
                "aa_dB": self.aa_dB,
                "ap_dB": self.ap_dB,
                "wa": self.wa,
                "wp": self.wp,
                "w0": self.w0,
                "bw": self.bw,
                "gamma": self.gamma,
                "tau0": self.tau0,
                "wrg": self.wrg,
            }
            if(self.helper_N == -1):
                params["N_min"] = self.N_min
                params["N_max"] = self.N_max
            elif(self.helper_N == 0):
                params["N_min"] = self.N
                params["N_max"] = self.N
            else:
                params["N_min"] = self.helper_N
                params["N_max"] = self.helper_N

            filt = AnalogFilter(**params)
            valid, msg = filt.validate()
            self.helperFilters.append(filt)

    def swapStages(self, index0, index1):
        temp = self.stages[index0]
        self.stages[index0] = self.stages[index1]
        self.stages[index1] = temp
    
    def orderStagesBySos(self):
        
        sos = signal.zpk2sos(self.remainingZeros, self.remainingPoles, 1, pairing='minimal', analog=True)
        for sosSection in sos:
            # print("Adding section N=", sosSection[0:3], " D=", sosSection[3:6])
            z_arr, p_arr, gain = signal.tf2zpk(sosSection[0:3], sosSection[3:6])
            newRemainingZeros = len(self.remainingZeros) - len(z_arr)
            newRemainingPoles = len(self.remainingPoles) - len(p_arr)

            if newRemainingZeros > newRemainingPoles:
                return False # se rompio todo

            append_gain = gain * np.power(self.remainingk, 1/len(sos))

            newStage_tf = TFunction(z_arr, p_arr, append_gain, normalize=False)

            self.stages.append(newStage_tf)
            self.implemented_tf.appendStage(newStage_tf)
            self.remainingGain /= append_gain
            # self.remainingk /= newStage_tf.k
            
            for z in z_arr:
                del_list = []
                for rz in self.remainingZeros:
                    if(np.isclose(z, rz)):
                        del_list.append(rz)
                for d in del_list:
                    self.remainingZeros.remove(d)
            for p in p_arr:
                del_list = []
                for rp in self.remainingPoles:
                    if(np.isclose(p, rp)):
                        del_list.append(rp)
                for d in del_list:
                    self.remainingPoles.remove(d)
        return True

    def getBandpassRange(self):
        if self.filter_type == LOW_PASS:
            return False, [0, self.wp]
        elif self.filter_type == HIGH_PASS:
            return False, [self.wp, 100*self.wp]
        elif self.filter_type == BAND_PASS:
            return False, self.wp
        elif self.filter_type == BAND_REJECT:
            return True, [[0, self.wp[0]], [self.wp[1], 100*self.wp[1]]]
        elif self.filter_type == GROUP_DELAY:
            return False, [0, self.wrg]

    def getDynamicRangeLoss(self, db=True):
        minGain, maxGain = self.getEdgeGainsInBP(db=db)
        if(minGain*maxGain > 0):
            return np.max(np.abs([maxGain, minGain]))
        return maxGain - minGain # max es + y min es -
    
    def getEdgeGainsInBP(self, db=True):
        isReject, bp = self.getBandpassRange()
        return self.tf.getEdgeGainsInRange(isReject, bp, db=db)

    def getStagesDynamicRangeLoss(self, db=True):
        isReject, bp = self.getBandpassRange()
        drl_acc = 0
        max_drl = 0
        for i, stage_tf in enumerate(self.stages):
            ming, maxg = stage_tf.getEdgeGainsInRange(isReject, bp, db=db)
            if(ming*maxg < 0):
                if(maxg > -ming):
                    drl_acc += maxg
                else:
                    drl_acc += ming
            else:
                if(maxg > 0):
                    drl_acc += maxg
                else:
                    drl_acc += ming
            if(np.abs(drl_acc) > max_drl):
                max_drl = np.abs(drl_acc)
        return max_drl

    def __eq__(self, other):
        if(isinstance(other, str)):
            return False
        return self.__dict__ == other.__dict__
