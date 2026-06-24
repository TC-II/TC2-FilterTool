import numpy as np
from scipy import signal
from abc import ABC, abstractmethod

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
MIN_RES = 1e+0
MIN_RES_EXP = 0
MAX_RES_EXP = 5
MAX_RES = 1e+6
MIN_CAP = 47e-12
MIN_CAP_EXP = -12
MAX_CAP_EXP = -3
MAX_CAP = 470e-6
IMPL_COUNT = 11
PASSIVERC, PASSIVERLC, INTEGDERIV, SALLENKEY, RAUCH, DOUBLET, SEDRA, KHN, TOWTHOMAS, ACKERBERG, FLEISCHERTOW = range(IMPL_COUNT)

class Cell(ABC):
    def __init__(self):
        self.tf = {}
        super().__init__()

    @abstractmethod
    def calculateComponentsZPK(self, z, p, k):
        pass
    @abstractmethod
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    @abstractmethod
    def transferFromComponents(self):
        pass

class Passive(Cell):
    def __init__(self, R=-1, C=-1):
        super().__init__()
        self.R = R
        self.C = C

    def calculateComponentsZPK(self, z, p, k):
        pass
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    def transferFromComponents(self):
        pass
    def calculateLP(self):
        # RC simple
        if(self.R < 0 and self.C > 0 and self.wc > 0):
            self.R = 1 / (self.wc * self.C)
        elif(self.R > 0 and self.C < 0 and self.wc > 0):
            self.C = 1 / (self.wc * self.R)
        elif (self.R > 0 and self.C > 0 and self.wc < 0):
            self.wc = 1 / (self.R * self.C)
        
        # for RE12 in E12:
        #     for i in range(MIN_RES_EXP, MAX_RES_EXP + 1):
        #         R = RE12 * (10 ** i)
        #         for CE12 in E12:
        #             for i in range(MIN_CAP_EXP, MAX_CAP_EXP + 1):
        #                 C = CE12 * (10 ** i)
        #                 valarr.append([1/(R*C), R, C])
        #                 print([1/np.sqrt(R*C), R, C])
        # return sorted(valarr, key = lambda v: np.abs(v[0]-wc))
        # return valarr

    def calculateHP(self):
        # CR simple
        pass
    def calculateBP(self):
        # RCRC
        pass
    def calculateBR(self):
        pass

class SallenKey(Cell):
    def __init__(self):
        super().__init__()

    def calculateComponentsZPK(self, z, p, k):
        pass
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    def transferFromComponents(self):
        pass
    def calculateLP(self):
        #self.K = 3 - 1 / self.Q 
        self.R1 = self.R2 = 1000 #valor arbitrario
        self.C1 = 1/(self.w0*self.R1)
        self.C2 = self.C1
        alfa = 3 - 1 / self.Q #Ra/Rb
        self.Rb = 100
        self.Ra = alfa*self.Rb
        pass
    def calculateHP(self):
        self.calculateLP() #Misma fórmula, cambia el orden espacial de componentes
        pass


class Rauch(Cell):
    def __init__(self):
        super().__init__()

    def calculateComponentsZPK(self, z, p, k):
        pass
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    def transferFromComponents(self):
        pass
    def calculateLP(self): #sacado del Pablombo
        assert self.gain < 0 #es inversor
        self.R1 = 1000
        self.R2 = -2*self.gain*self.R1 # H(j*w0) = -R2/(2*R1)
        self.R3 = self.R1 / (((2*self.Q)**2 * (self.R1/self.R2)) -1)
    def calculateHP(self):
        self.calculateLP()

class Sedra(Cell):
    def __init__(self):
        self.Q0 = 1
        super().__init__()

    def calculateComponentsZPK(self, z, p, k):
        pass
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    def transferFromComponents(self):
        pass

    def calculateLP(self):
        pass
    def calculateHP(self):
        pass

class DoubleT(Cell):
    def __init__(self):
        super().__init__()

    def calculateComponentsZPK(self, z, p, k):
        pass
    def calculateComponentsND(self, Ncoeff, Dcoeff):
        pass
    def transferFromComponents(self):
        pass

    def calculateLP(self):
        pass
    def calculateHP(self):
        pass

class FleischerTow(Cell):
    def __init__(self, C1=1e-9, C2=1e-9, R8=1e3, k1=1e0, k2=1e0):
        self.C1 = C1
        self.C2 = C2
        self.R8 = R8
        self.k1 = k1
        self.k2 = k2

    def calculateComponentsZPK(self, z, p, k):
        tftemp = signal.zpk2tf(z, p, k)
        self.calculateComponentsND(tftemp[0], tftemp[1])

    def calculateComponentsND(self, Ncoeff, Dcoeff):
        assert len(Dcoeff) >= len(Ncoeff)
        assert len(Dcoeff) < 4

        m = Ncoeff[0] / Dcoeff[0]
        c = Ncoeff[1] / Dcoeff[0]
        d = Ncoeff[2] / Dcoeff[0]
        a = Dcoeff[1] / Dcoeff[0]
        b = Dcoeff[2] / Dcoeff[0]

        self.wz = np.sqrt(d / m)
        self.wp = np.sqrt(b)
        Q = np.sqrt(b) / a
        fp = self.wp / (2*np.pi)
        bw = fp / Q
        if(m == 0 and c == 0):
            self.R4 = np.float64(1)/0
            self.R5 = self.k1 * np.sqrt(b) / (d * self.C2)
            self.R6 = np.float64(1)/0
        elif(m == 0 and d == 0):
            self.R4 = 1 / (- self.k2 * c * self.C1)
            self.R5 = np.float64(1)/0
            self.R6 = np.float64(1)/0
        elif(c == 0 and d == 0):
            self.R4 = 1 / (self.k2 * m * a * self.C1)
            self.R5 = np.float64(1)/0
            self.R6 = self.R8 / m
        else:
            self.R4 = 1 / (self.k2 * (m * a - c) * self.C1)
            self.R5 = self.k1 * np.sqrt(b) / (d * self.C2)
            self.R6 = self.R8 / m

        self.R1 = 1 / (a * self.C1)
        self.R2 = self.k1 / (np.sqrt(b) * self.C2)
        self.R3 = 1 / (self.k1 * self.k2 * np.sqrt(b) * self.C1)
        self.R7 = self.k2 * self.R8

        self.resistors = [0, self.R1, self.R2, self.R3, self.R4, self.R5, self.R6, self.R7, self.R8]
        self.capacitors = [0, self.C1, self.C2]

    def transferFromComponents(self):
        m = self.R8 / self.R6
        c = (self.R8 / (self.R1 * self.C1)) * (1 / self.R6 - self.R1 / (self.R4 * self.R7))
        d = self.R8 / (self.R3 * self.R5 * self.R7 * self.C1 * self.C2)
        a = 1 / (self.R1 * self.C1)
        b = self.R8 / (self.R2 * self.R3 * self.C1 * self.C2 * self.R7)

        self.tf = signal.TransferFunction([m, c, d], [1, a, b])