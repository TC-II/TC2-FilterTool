from collections import defaultdict

class Dataline():
    def __init__(self, dataset, name='', casenum=0, color='#CDCDCD', xsource='', ysource=''):
        self.name = name
        self.color = color
        self.plots = 0
        self.transform = 0
        self.xsource = xsource
        self.xscale = 1
        self.xoffset = 0
        self.ysource = ysource
        self.yscale = 1
        self.yoffset = 0
        self.linestyle = 'Solid'
        self.linewidth = 1
        self.markerstyle = 'None'
        self.markersize = 4
        self.savgolwindow = 1
        self.savgolord = 0
        self.casenum = casenum
        self.dataset = dataset