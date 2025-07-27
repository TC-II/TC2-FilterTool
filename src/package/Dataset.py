from unicodedata import name
import ltspice
import matplotlib.pyplot as plt
import numpy as np
import csv
from src.package.transfer_function import TFunction
from src.package.Filter import AnalogFilter
from collections import defaultdict
from PyQt5.QtCore import QFileInfo
from src.package.Dataline import Dataline
import scipy.signal as signal
class Dataset:
    def __init__(self, filepath='', title='', origin=''):
        qfi = QFileInfo(filepath)

        self.color = 0
        self.data = []
        self.zeros = []
        self.poles = []
        self.type = ''
        self.origin = filepath if origin == '' else origin
        self.tf = TFunction()
        self.title = qfi.fileName() if title == '' else title
        self.text = self.title
        self.datalines = []
        self.fields = []
        self.miscinfo = ''
        self.casenames = []
        self.suggestedXscale = 1
        self.suggestedYscale = 1
        self.suggestedXsource = ''
        self.suggestedYsource = ''

        extension = qfi.suffix()
        if(extension == 'raw'):
            self.type = 'spice'
            self.parse_from_spice(filepath)
        elif(extension == 'csv'):
            self.type = 'csv'
            self.parse_from_csv(filepath)
        elif(extension == 'txt'):
            self.type = 'txt'
            self.parse_from_txt(filepath)
        elif(filepath == ''):
            if isinstance(self.origin, AnalogFilter):
                self.tf = self.origin.tf
                self.type = 'filter'
                self.parse_from_filter()
            else:
                self.tf = self.origin
                self.type = 'TF'
                self.parse_from_expression()
        else:
            raise ValueError
        
        for field in self.data[0]:
            self.fields.append(field)
        
    def parse_from_spice(self, filepath):
        l = ltspice.Ltspice(filepath)
        l.parse()
        self.data = []
        self.miscinfo += f'Spice simulation, MODE: {l._mode}'
        for i in range(l.case_count):
            self.data.append(defaultdict(list))
            for varname in l.variables:
                vardata = []
                if(varname == 'time'):
                    vardata = l.get_time(case=i)
                elif(varname == 'frequency'):
                    vardata = l.get_frequency(case=i)
                else:
                    vardata = l.get_data(name=varname, case=i)
                self.data[i][varname] = vardata

    def parse_from_txt(self, filepath):
        has_cases = False
        self.data = [{}]
        with open(filepath, mode='r') as file:
            for line in file.readlines():
                if('Step Information:' in line):
                    has_cases = True
                    break

        with open(filepath, mode='r') as file:
            fields = file.readline().replace('\n', '').split('\t')
            for field in fields:
                self.data[0][field] = []
            case = -1
            if(has_cases):
                for line in file.readlines():
                    if('Step Information:' in line):
                        self.data.append(defaultdict(list))
                        if('Run:' in line):
                            self.casenames.append(line[18:line.index('  (Run: ')])
                        elif('Step:' in line):
                            self.casenames.append(line[18:line.index('  (Step: ')])
                        case += 1
                    else:
                        linedata = line.replace('\n', '').split('\t')
                        for x in range(len(fields)):
                            if('i' in linedata[x]):
                                self.data[case][fields[x]].append(np.complex128(linedata[x]))
                            else:
                                self.data[case][fields[x]].append(float(linedata[x]))
            else:
                for line in file.readlines():
                    linedata = line.replace('\n', '').split('\t')
                    for x in range(len(fields)):
                        if('dB' in linedata[x]):
                            newlindata = linedata[x][1:-2].split('dB,')
                            self.data[0][fields[x]].append(float(newlindata[0]))
                            try:
                                self.data[0][fields[x] + ' deg'].append(float(newlindata[1]))
                            except KeyError:
                                self.data[0][fields[x] + ' deg'] = [float(newlindata[1]),]
                        elif(',' in linedata[x]):
                            self.data[0][fields[x]].append(complex(linedata[x].replace(',','+').replace('+-','-') + 'j'))
                        else:
                            self.data[0][fields[x]].append(float(linedata[x]))
                    


    def parse_from_csv(self, filepath):
        with open(filepath, mode='r') as csv_file:
            i = 0
            for line in csv_file:
                if line[0] == '#' or len(line) < 3:
                    i += len(line)
                else:
                    break
            csv_file.seek(i) #Salteo los comentario y me paro donde esta lo que importa
            csv_reader = csv.DictReader(csv_file)
            self.data = [{}]
            first_row = next(csv_reader)
            for (field, val) in first_row.items():
                self.data[0][field] = []

            csv_file.seek(i)
            csv_reader = csv.DictReader(csv_file)

            for row in csv_reader:
                for (field, val) in row.items():
                    try:
                        if('i' in val or 'j' in val):
                            self.data[0][field].append(np.complex128(val))
                        elif(val != ''):
                            self.data[0][field].append(float(val))
                        # else:
                        #     maxlen = len(self.data[0][field])
                        #     for (field2, val2) in row.items():
                        #         self.data[0][field2] = self.data[0][field2][:maxlen]
                        #     break
                    except(ValueError):
                        pass
                    except(TypeError):
                        pass
                    except(KeyError):
                        pass
                    
            if('rigol' in filepath.lower()):
                self.miscinfo += ('- taken from Rigol DSO')
                self.suggestedXscale = float(self.data[0]['Increment'][0])
                if('' in self.data[0]):
                    self.data[0].pop('')
                self.data[0].pop('Increment')
                self.data[0].pop('Start')
                self.suggestedXsource = 'X'
                for chnum in ['CH4', 'CH3', 'CH2', 'CH1']:
                    if(chnum in self.data[0]):
                        self.suggestedYsource = chnum
            elif('agilent' in filepath.lower()):
                self.miscinfo += ('- taken from Agilent DSO')
                self.suggestedXsource = 'x-axis'
                for chnum in ['4', '3', '2', '1']:
                    if(chnum in self.data[0]):
                        self.suggestedYsource = chnum
            csv_file.close()

    def parse_from_expression(self):
        f, g, ph, gd = self.tf.getBode()
        tstep, stepr = signal.step(self.tf.tf_object, N=5000)
        timp, impr = signal.impulse(self.tf.tf_object, N=5000)
        z, p = self.tf.getZP()
        self.data = [{}]
        self.zeros = [{}]
        self.poles = [{}]
        self.data[0]['f'] = f
        self.data[0]['g'] = g
        self.data[0]['ph'] = ph
        self.data[0]['gd'] = gd
        self.data[0]['tstep'] = tstep
        self.data[0]['stepr'] = stepr
        self.data[0]['timp'] = timp
        self.data[0]['impr'] = impr
        self.zeros[0] = z
        self.poles[0] = p
        self.suggestedXsource = 'f'
        self.suggestedYsource = 'g'
    
    def parse_from_filter(self):
        f, g, ph, gd = self.tf.getBode()
        z, p = self.tf.getZP()
        self.data = [{}]
        self.zeros = [{}]
        self.poles = [{}]
        self.data[0]['f'] = f
        self.data[0]['g'] = g
        self.data[0]['ph'] = ph
        self.data[0]['gd'] = gd
        self.zeros[0] = z
        self.poles[0] = p
        self.suggestedXsource = 'f'
        self.suggestedYsource = 'g'
            
    def get_datapoints(self, xvar_name='time', yvar_name='v', case=0):
        xdata = np.real(self.data[case][xvar_name])
        ydata = np.array(self.data[case][yvar_name])
        return (xdata, ydata)

    def create_dataline(self, casenum=0):
        name = f'{self.title} {len(self.datalines) + 1}'
        dl = Dataline(self, name=name, casenum=casenum, color='#303030', xsource=self.suggestedXsource, ysource=self.suggestedYsource)
        dl.xscale = self.suggestedXscale
        dl.yscale = self.suggestedYscale
        if(self.type == 'csv' or self.type == 'spice'):
            dl.linestyle = 'None'
            dl.markerstyle = 'Point'
        self.datalines.append(dl)
        return dl