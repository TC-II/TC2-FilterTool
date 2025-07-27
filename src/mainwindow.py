# PyQt5 modules
from math import inf
from PyQt5.QtWidgets import QMainWindow, QListWidgetItem, QColorDialog, QFileDialog, QDialog, QStyle
from PyQt5.QtCore import Qt, QCoreApplication

# Project modules
from src.ui.mainwindow import Ui_MainWindow
from src.package.Dataset import Dataset
import src.package.Filter as Filter
import src.package.CellCalculator as CellCalculator
import src.package.transfer_function as TF
from src.package.Filter import AnalogFilter, NORM_CB_DC, NORM_CB_HF, NORM_CB_BP, NORM_CB_PB
from src.widgets.fleischer_tow_window import FleischerTowDialog
from src.widgets.tf_dialog import TFDialog
from src.widgets.case_window import CaseDialog
from src.widgets.zp_window import ZPWindow
from src.widgets.response_dialog import ResponseDialog
from src.widgets.prompt_dialog import PromptDialog

from scipy.signal import savgol_filter
import scipy.signal as signal
import matplotlib.ticker as ticker
from matplotlib.pyplot import Circle
from mplcursors import  cursor, Selection

import numpy as np
import random
from pyparsing.exceptions import ParseSyntaxException

import pickle

MARKER_STYLES = { 'None': '', 'Point': '.',  'Pixel': ',',  'Circle': 'o',  'Triangle down': 'v',  'Triangle up': '^',  'Triangle left': '<',  'Triangle right': '>',  'Tri down': '1',  'Tri up': '2',  'Tri left': '3',  'Tri right': '4',  'Octagon': '8',  'Square': 's',  'Pentagon': 'p',  'Plus (filled)': 'P',  'Star': '*',  'Hexagon': 'h',  'Hexagon alt.': 'H',  'Plus': '+',  'x': 'x',  'x (filled)': 'X',  'Diamond': 'D',  'Diamond (thin)': 'd',  'Vline': '|',  'Hline': '_' }
LINE_STYLES = { 'None': '', 'Solid': '-', 'Dashed': '--', 'Dash-dot': '-.', 'Dotted': ':' }
DEFAULT_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2']
CANON_COLORS = [
    '#1f77b4',      # azul, butter
    '#d62728',      # rojo, cheby I
    '#2ca02c',      # verde, cheby II
    '#ff7f0e',      # naranja, cauer
    '#9467bd',      # violeta, optimo l
    '#e377c2',      # rosa, bessel
    '#8c564b',      # marrón, gauss
]

POLE_COLOR = '#FF0000'
POLE_SEL_COLOR = '#00FF00'
ZERO_COLOR = '#0000FF'
ZERO_SEL_COLOR = '#00FF00'

TEMPLATE_FACE_COLOR = '#ffcccb'
TEMPLATE_EDGE_COLOR = '#ef9a9a'
ADD_TEMPLATE_FACE_COLOR = '#c8e6c9'
ADD_TEMPLATE_EDGE_COLOR = '#a5d6a7'


F_TO_W = 2*np.pi
W_TO_F = 1/F_TO_W

PZ_LIM_SCALING = 1.35

def stage_to_str(stage, k):
    stage_str = 'Z={'
    for z in stage.z:
        stage_str += "{0:.3}j".format(np.imag(z))
        stage_str += ', '
    if(len(stage.z) > 0):
        stage_str = stage_str[0:-2]
    stage_str += '} , P={'
    for p in stage.p:
        stage_str += "{0:.3g}".format(p)
        stage_str += ', '
    if(len(stage.p) > 0):
        stage_str = stage_str[0:-2]
    stage_str += '}} , K={0:.2g} dB'.format(20*np.log10(stage.gain))
    return stage_str

class MainWindow(QMainWindow, Ui_MainWindow):

    def __init__(self):
        super(MainWindow, self).__init__()
        self.setupUi(self)
        self.droppedFiles = []
        self.datasets = []
        self.datalines = []
        # self.stage_datasets = [] capaz mas adelante lo ponga para serializar también las etapas, pero creo que para ahora es mucho
        self.selected_dataset_widget = {}
        self.selected_dataline_widget = {}
        self.selected_dataset_data = {}
        self.selected_dataline_data = {}
        self.zpWindow = type('ZPWindow', (), {})()
        
        self.import_file_btn.clicked.connect(self.importFiles)
        
        self.dataset_list.currentItemChanged.connect(self.populateSelectedDatasetDetails)
        self.ds_title_edit.textEdited.connect(self.updateSelectedDatasetName)
        self.ds_addline_btn.clicked.connect(self.addDataline)
        self.ds_remove_btn.clicked.connect(self.removeSelectedDataset)
        self.ds_poleszeros_btn.clicked.connect(self.showZPWindow)

        self.dataline_gb.setEnabled(False)
        self.dataline_list.currentItemChanged.connect(self.populateSelectedDatalineDetails)
        self.dl_name_edit.textEdited.connect(self.updateSelectedDataline)
        self.dl_render_cb.activated.connect(self.updateSelectedDataline)
        self.dl_transform_cb.activated.connect(self.updateSelectedDataline)
        self.dl_xdata_cb.activated.connect(self.updateSelectedDataline)
        self.dl_xscale_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_xoffset_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_ydata_cb.activated.connect(self.updateSelectedDataline)
        self.dl_yscale_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_yoffset_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_color_edit.textEdited.connect(self.updateSelectedDataline)
        self.dl_style_cb.activated.connect(self.updateSelectedDataline)
        self.dl_linewidth_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_marker_cb.activated.connect(self.updateSelectedDataline)
        self.dl_markersize_sb.valueChanged.connect(self.updateSelectedDataline)
        self.dl_remove_btn.clicked.connect(self.removeSelectedDataline)
        self.dl_savgol_wlen.valueChanged.connect(self.updateSelectedDataline)
        self.dl_savgol_ord.valueChanged.connect(self.updateSelectedDataline)

        self.dl_color_pickerbtn.clicked.connect(self.openColorPicker)

        self.respd = ResponseDialog()
        self.resp_btn.clicked.connect(self.openResponseDialog)
        self.respd.accepted.connect(self.resolveResponseDialog)

        self.tfd = TFDialog()
        self.function_btn.clicked.connect(self.openTFDialog)
        self.tfd.accepted.connect(self.resolveTFDialog)

        self.csd = CaseDialog()
        self.ds_caseadd_btn.clicked.connect(self.openCaseDialog)
        self.csd.accepted.connect(self.resolveCSDialog)

        self.pmptd = PromptDialog()
        
        self.plt_labelsize_sb.valueChanged.connect(self.updatePlots)
        self.plt_legendsize_sb.valueChanged.connect(self.updatePlots)
        self.plt_ticksize_sb.valueChanged.connect(self.updatePlots)
        self.plt_titlesize_sb.valueChanged.connect(self.updatePlots)
        self.plt_autoscale.clicked.connect(self.autoscalePlots)
        self.plt_legendpos.activated.connect(self.updatePlots)
        self.plt_grid.stateChanged.connect(self.updatePlots)
        self.tabbing_plots.currentChanged.connect(self.updatePlots)
        
        self.plots_canvases = [
            [ self.plot_1 ],
            [ self.plot_2_1, self.plot_2_2 ],
            [ self.plot_3 ],
            [ self.plot_4_1, self.plot_4_2 ],
            [ self.plot_5 ],
        ]

        self.new_filter_btn.clicked.connect(self.addFilter)
        self.chg_filter_btn.clicked.connect(self.changeSelectedFilter)
        self.tipo_box.currentIndexChanged.connect(self.updateFilterParametersAvailable)
        self.define_with_box.currentIndexChanged.connect(self.updateFilterParametersAvailable)
        self.aprox_box.currentIndexChanged.connect(self.updateComparisonAproxOptions)
        self.updateFilterParametersAvailable()

        self.new_stage_btn.clicked.connect(self.addFilterStage)
        self.remove_stage_btn.clicked.connect(self.removeFilterStage)

        self.actionLoad_2.triggered.connect(self.loadFile)
        self.actionSave_2.triggered.connect(self.saveFile)

        self.stageCursorZer = {}
        self.stageCursorPol = {}

        self.poles_list.itemSelectionChanged.connect(self.stage_sel_changed)
        self.zeros_list.itemSelectionChanged.connect(self.stage_sel_changed)
        self.stages_list.itemSelectionChanged.connect(self.updateStagePlots)

        self.filters = []
        self.selfil_cb.currentIndexChanged.connect(self.populateSelectedFilterDetails)
        self.stages_selfil_cb.currentIndexChanged.connect(self.populateSelectedFilterDetails)
        self.symmetrize_btn.clicked.connect(self.makeFilterTemplateSymmetric)

        self.sswapup_btn.setIcon(self.style().standardIcon(QStyle.SP_TitleBarShadeButton))
        self.sswapdown_btn.setIcon(self.style().standardIcon(QStyle.SP_TitleBarUnshadeButton))
        self.sswapup_btn.clicked.connect(self.swapStagesUpwards)
        self.sswapdown_btn.clicked.connect(self.swapStagesDownwards)
        self.autoselectstagessp_btn.clicked.connect(self.orderStagesBySos)

        self.prevFilterType = Filter.LOW_PASS
        self.compareapprox_cb.setCurrentIndexes([])
        self.updateComparisonAproxOptions(self.aprox_box.currentIndex())

        self.si_calc_btn.clicked.connect(self.openImplementationDialog)
        self.tabWidget_2.currentChanged.connect(self.redrawFilterPlots)
        self.tabWidget_3.currentChanged.connect(self.redrawStagePlots)
        self.filterPlots = [self.fplot_att, self.fplot_mag, self.fplot_phase, self.fplot_gd, self.fplot_pz, self.fplot_step, self.fplot_impulse]
        self.stagePlots = [self.splot_fpz, self.splot_tpz, self.splot_tgain, self.splot_tphase, self.splot_stagesmag, self.splot_pz, self.splot_sgain, self.splot_sphase, self.splot_simp, self.splot_sstep]
        self.redrawFilterPlotsArr = [True] * len(self.filterPlots)
        self.redrawStagePlotsArr = [True] * len(self.stagePlots)
        
        self.ftd = FleischerTowDialog()

        self.fgetHhuman_btn.clicked.connect(self.copyFilterHhuman)
        self.fgetHlatex_btn.clicked.connect(self.copyFilterHlatex)
        self.sgetHhuman_btn.clicked.connect(self.copyStageHhuman)
        self.sgetHlatex_btn.clicked.connect(self.copyStageHlatex)
        
        self.filterPoleCursor = None
        self.filterZerCursor = None
        self.totalStagesZeroCursor = None
        self.totalStagesPoleCursor = None
        self.stageLoneZeroCursor = None
        self.stageLonePoleCursor = None

        self.actionUse_Hz.triggered.connect(self.selectUseHz)
        self.actionUse_rad_s.triggered.connect(self.selectUseRadians)
        
        self.actionColorsCanonical.triggered.connect(self.selectUseCanonical)
        self.actionColorsRandom.triggered.connect(self.selectUseRandom)
        
        self.cb_flegends.stateChanged.connect(self.updateFilterLegends)
        
        self.use_hz = True
        self.SING_B_TO_F = W_TO_F if self.use_hz else 1
        self.SING_F_TO_B = F_TO_W if self.use_hz else 1
        self.PZ_XLABEL = f'$\sigma$ [1/s]' if self.use_hz else '$\sigma$ ($rad/s$)'
        self.PZ_YLABEL = f'$jf$ [Hz]' if self.use_hz else '$j\omega$ ($rad/s$)'
        self.FREQ_LABEL = f'Frecuencia [Hz]' if self.use_hz else 'Frecuencia angular ($rad/s$)'
        self.updateComparisonAproxOptions(self.aprox_box.currentIndex())

    def updateFilterLegends(self):
        if(self.cb_flegends.isChecked()):
            self.fplot_att.canvas.ax.legend()
            self.fplot_mag.canvas.ax.legend()
            self.fplot_phase.canvas.ax.legend()
            self.fplot_gd.canvas.ax.legend()
            self.fplot_step.canvas.ax.legend()
            self.fplot_impulse.canvas.ax.legend()
            self.fplot_pz.canvas.ax.legend()
        else:           
            self.fplot_att.canvas.ax.get_legend().remove()
            self.fplot_mag.canvas.ax.get_legend().remove()
            self.fplot_phase.canvas.ax.get_legend().remove()
            self.fplot_gd.canvas.ax.get_legend().remove()
            self.fplot_step.canvas.ax.get_legend().remove()
            self.fplot_impulse.canvas.ax.get_legend().remove()
            self.fplot_pz.canvas.ax.get_legend().remove()
        self.fplot_att.canvas.draw_idle()
        self.fplot_mag.canvas.draw_idle()
        self.fplot_phase.canvas.draw_idle()
        self.fplot_gd.canvas.draw_idle()
        self.fplot_step.canvas.draw_idle()
        self.fplot_impulse.canvas.draw_idle()
        self.fplot_pz.canvas.draw_idle()

    def updateComparisonAproxOptions(self, index):
        self.compareapprox_cb.model().item(index).setCheckState(False)
        for i in range(self.compareapprox_cb.count()):
            self.compareapprox_cb.model().item(i).setEnabled(i != index)

    def selectUseCanonical(self):
        self.actionColorsCanonical.setChecked(True)
        self.actionColorsRandom.setChecked(False)
        self.updateFilterPlots()

    def selectUseRandom(self):
        self.actionColorsCanonical.setChecked(False)
        self.actionColorsRandom.setChecked(True)
        self.updateFilterPlots()

    def selectUseHz(self):
        if(self.actionUse_Hz.isChecked()):
            self.actionUse_rad_s.setChecked(False)
            self.updateFequencySettings(True)
        else:
            self.actionUse_rad_s.setChecked(True)
            self.selectUseRadians()

    def selectUseRadians(self):
        if(self.actionUse_rad_s.isChecked()):
            self.actionUse_Hz.setChecked(False)
            self.updateFequencySettings(False)
        else:
            self.actionUse_Hz.setChecked(True)
            self.selectUseHz()

    def updateFequencySettings(self, useHz):
        self.use_hz = useHz
        suffix = 'Hz' if useHz else 'rad/s'
        self.label_fpmin.setText('fp min' if useHz else 'ωp min')
        self.label_famin.setText('fa min' if useHz else 'ωa min')
        self.label_fp.setText('fp' if useHz else 'ωp')
        self.label_fa.setText('fa' if useHz else 'ωa')
        self.label_f0.setText('f0' if useHz else 'ω0')
        self.label_fRG.setText('fRG' if useHz else 'ωRG')

        self.fp_box.setSuffix(suffix)
        self.fa_box.setSuffix(suffix)
        self.fp_min_box.setSuffix(suffix)
        self.fa_min_box.setSuffix(suffix)
        self.bw_max_box.setSuffix(suffix)
        self.bw_min_box.setSuffix(suffix)
        self.frg_box.setSuffix(suffix)
        self.f0_box.setSuffix(suffix)

        self.fp_box.setValue(self.fp_box.value()*(W_TO_F if useHz else F_TO_W))
        self.fa_box.setValue(self.fa_box.value()*(W_TO_F if useHz else F_TO_W))
        self.fp_min_box.setValue(self.fp_min_box.value()*(W_TO_F if useHz else F_TO_W))
        self.fa_min_box.setValue(self.fa_min_box.value()*(W_TO_F if useHz else F_TO_W))
        self.bw_max_box.setValue(self.bw_max_box.value()*(W_TO_F if useHz else F_TO_W))
        self.bw_min_box.setValue(self.bw_min_box.value()*(W_TO_F if useHz else F_TO_W))
        self.frg_box.setValue(self.frg_box.value()*(W_TO_F if useHz else F_TO_W))
        self.f0_box.setValue(self.f0_box.value()*(W_TO_F if useHz else F_TO_W))
        self.define_with_box.setItemText(0, 'fa, fp' if useHz else 'ωa, ωp')
        self.define_with_box.setItemText(1, 'f0, Bw' if useHz else 'ω0, Bw')

        self.SING_B_TO_F = W_TO_F if self.use_hz else 1
        self.SING_F_TO_B = F_TO_W if self.use_hz else 1
        self.PZ_XLABEL = f'$\sigma$ [1/s]' if self.use_hz else '$\sigma$ ($rad/s$)'
        self.PZ_YLABEL = f'$jf$ [Hz]' if self.use_hz else '$j\omega$ ($rad/s$)'
        self.FREQ_LABEL = f'Frecuencia [Hz]' if self.use_hz else 'Frecuencia angular ($rad/s$)'

        self.updateFilterPlots()
        self.updateStagePlots()

    def addDataset(self, ds):
        qlwt = QListWidgetItem()
        qlwt.setData(Qt.UserRole, ds)
        qlwt.setText(ds.title)
        self.dataset_list.addItem(qlwt)
        self.datasets.append(ds)
        self.datalines.append([])
        self.dataset_list.setCurrentRow(self.dataset_list.count() - 1)

    def removeDataset(self, i):
        #Saco los datalines
        first_dataline_index = 0
        last_dataline_index = len(self.datalines[0])
        for x in range(self.dataset_list.count()):
            if(x == 0):
                first_dataline_index = 0
            else:    
                first_dataline_index += len(self.datalines[x - 1])
            if(x == i):
                break
        last_dataline_index = first_dataline_index + len(self.datalines[i])

        for x in range(first_dataline_index, last_dataline_index):
            self.dataline_list.takeItem(first_dataline_index)
        self.datalines.pop(i)

        ds = self.dataset_list.item(i).data(Qt.UserRole)
        if(ds.type == 'filter'):
            fi = self.filters.index(ds)
            self.filters.pop(fi)
            self.selfil_cb.removeItem(fi)
            self.stages_selfil_cb.removeItem(fi)
            if(self.selfil_cb.count() == 0):
                self.chg_filter_btn.setEnabled(False)
                self.fgetHhuman_btn.setEnabled(False)
                self.fgetHlatex_btn.setEnabled(False)
                self.sgetHhuman_btn.setEnabled(False)
                self.sgetHlatex_btn.setEnabled(False)
        self.dataset_list.takeItem(i)
        self.updatePlots()

    def addDataline(self):
        if(not self.selected_dataset_data):
            return
        dl = self.selected_dataset_data.create_dataline()
        qlwt = QListWidgetItem()
        qlwt.setData(Qt.UserRole, dl)
        qlwt.setText(dl.name)
        dli = 0
        for x in range(self.dataset_list.count()):
            ds = self.dataset_list.item(x).data(Qt.UserRole)
            dli += len(self.datalines[x])
            if(ds.origin == self.selected_dataset_data.origin):
                break
        self.dataline_list.insertItem(dli, qlwt)
        self.dataline_list.setCurrentRow(dli)
        self.datalines[self.dataset_list.currentRow()].append(dl)
        self.updateSelectedDataline()
        self.updatePlots()

    def removeDataline(self, i):        
        try:
            dsi, dli = self.getInternalDataIndexes(i)
            del self.datalines[dsi][dli]
            self.dataline_list.takeItem(i).data(Qt.UserRole)
            del self.dataset_list.item(dsi).data(Qt.UserRole).datalines[dli]
            if(self.dataline_list.currentRow() == -1):
                self.dataline_list.setCurrentRow(self.dataline_list.count() - 1)
        except AttributeError:
            pass
        except UnboundLocalError:
            pass
        self.updatePlots()
    
    def removeSelectedDataline(self, event):
        selected_row = self.dataline_list.currentRow()
        self.removeDataline(selected_row)

    def removeSelectedDataset(self, event):
        selected_row = self.dataset_list.currentRow()
        self.removeDataset(selected_row)

    def getInternalDataIndexes(self, datalineRow):
        i = self.dataline_list.currentRow()
        for x in range(self.dataset_list.count()):
            ds = self.dataset_list.item(x).data(Qt.UserRole)
            if(i >= len(self.datalines[x])):
                i = i - len(self.datalines[x])
            else:
                return (x, i)
        return (x, i)

    def dragEnterEvent(self, event):
        if(event.mimeData().hasUrls()):
            event.accept()
        else:
            event.ignore()

    def dropEvent(self, event):
        self.statusbar.showMessage('Loading files')
        files = [u.toLocalFile() for u in event.mimeData().urls()]
        self.processFiles(files)

    def importFiles(self):
        options = QFileDialog.Options()
        # options |= QFileDialog.DontUseNativeDialog
        files, _ = QFileDialog.getOpenFileNames(self,"Select files", "","All Files (*);;CSV files (*.csv);;SPICE output files (*.raw)", options=options)
        self.processFiles(files)

    def processFiles(self, filenamearray):
        for f in filenamearray:
            # try:
            ds = Dataset(filepath=f)
            dataset_items_origin = [
                self.dataset_list.item(x).data(Qt.UserRole).origin
                for x in range(self.dataset_list.count())
            ]
            if(ds.origin not in dataset_items_origin):
                self.droppedFiles.append(ds.origin)
                self.addDataset(ds)
            # except(ValueError):
            #     print('Wrong file config')
        self.statusbar.clearMessage()

    def openTFDialog(self):
        self.tfd.open()
        self.tfd.tf_title.setFocus()

    def resolveTFDialog(self):
        if not self.tfd.validateTF():
            return
        ds = Dataset(filepath='', origin=self.tfd.tf, title=self.tfd.getTFTitle())
        self.addDataset(ds)

    def openResponseDialog(self):
        self.respd.open()
        self.respd.input_txt.setFocus()

    def resolveResponseDialog(self):
        if not(self.respd.validateResponse()):
            return

        t = self.respd.getTimeDomain()
        expression = self.respd.getResponseExpression()
        title = self.respd.getResponseTitle()
        time_title = title + "_timebase"
        ans_title = title + "_ans"
        
        if expression == 'step':
            x = np.heaviside(t, 0.5)
            _, response = signal.step(self.selected_dataset_data.tf.tf_object, T=t)
        elif expression == 'delta':
            delta = lambda t, eps: (1 / (np.sqrt(np.pi) *eps)) * np.exp(-(t/eps)**2) #para plotear la delta
            x = delta(t, (t[1] - t[0]))
            _, response = signal.impulse(self.selected_dataset_data.tf.tf_object, T=t)
        else:
            x = eval(expression)
            response = signal.lsim(self.selected_dataset_data.tf.tf_object , U = x , T = t)[1]
        
        self.selected_dataset_data.data[0][time_title] = t
        self.selected_dataset_data.data[0][title] = x
        self.selected_dataset_data.data[0][ans_title] = response

        self.selected_dataset_data.fields.append(time_title)
        self.selected_dataset_data.fields.append(title)
        self.selected_dataset_data.fields.append(ans_title)
        
        self.populateSelectedDatasetDetails(self.selected_dataset_widget, None)
        self.updateSelectedDataline()

    def buildFilterFromParams(self):
        # if(self.prevFilterType != self.tipo_box.currentIndex()):
        #     self.compareapprox_cb.setCurrentIndexes([])
        self.prevFilterType = self.tipo_box.currentIndex()
        if self.tipo_box.currentIndex() in [Filter.BAND_PASS, Filter.BAND_REJECT]:
            wa = [self.SING_F_TO_B * self.fa_min_box.value(), self.SING_F_TO_B * self.fa_max_box.value()]
            wp = [self.SING_F_TO_B * self.fp_min_box.value(), self.SING_F_TO_B * self.fp_max_box.value()]
        else:
            wa = self.SING_F_TO_B * self.fa_box.value()
            wp = self.SING_F_TO_B * self.fp_box.value()
            
        params = {
            "name": self.filtername_box.text(),
            "filter_type": self.tipo_box.currentIndex(),
            "approx_type": self.aprox_box.currentIndex(),
            "helper_approx": self.compareapprox_cb.currentIndexes(),
            "helper_N": self.comp_N_box.value(),
            "is_helper": False,
            "define_with": self.define_with_box.currentIndex(),
            "N_min": self.N_min_box.value(),
            "N_max": self.N_max_box.value(),
            "gain": 10**(self.gain_box.value()/20),
            "denorm": self.denorm_box.value(),
            "aa_dB": self.aa_box.value(),
            "ap_dB": self.ap_box.value(),
            "wa": wa,
            "wp": wp,
            "w0": self.SING_F_TO_B * self.f0_box.value(),
            "bw": [self.SING_F_TO_B * self.bw_min_box.value(), self.SING_F_TO_B * self.bw_max_box.value()],
            "gamma": self.tol_box.value(),
            "tau0": self.tau0_box.value(),
            "wrg": self.SING_F_TO_B * self.frg_box.value(),
        }
        return AnalogFilter(**params)
    
    def addFilter(self):
        newFilter = self.buildFilterFromParams()
        valid, msg = newFilter.validate()
        if not valid:
            self.pmptd.setErrorMsg(msg)
            self.pmptd.open()
            self.pmptd.setFocus()
            return
        ds = Dataset(filepath='', origin=newFilter, title=self.filtername_box.text())
        self.filters.append(ds)
        self.selfil_cb.blockSignals(True)
        self.stages_selfil_cb.blockSignals(True)
        self.selfil_cb.addItem(ds.title, ds)
        self.stages_selfil_cb.addItem(ds.title, ds)
        self.selfil_cb.blockSignals(False)
        self.stages_selfil_cb.blockSignals(False)
        self.chg_filter_btn.setEnabled(True)
        self.fgetHhuman_btn.setEnabled(True)
        self.fgetHlatex_btn.setEnabled(True)
        self.sgetHhuman_btn.setEnabled(True)
        self.sgetHlatex_btn.setEnabled(True)
        self.addDataset(ds)
    
    def makeFilterTemplateSymmetric(self):
        fa = [self.fa_min_box.value(), self.fa_max_box.value()]
        fp = [self.fp_min_box.value(), self.fp_max_box.value()]
        f0 = 0
        bw = [0, 0]
        if(self.tipo_box.currentIndex() == Filter.BAND_PASS):
            f0 = np.sqrt(fp[0] * fp[1])
            bw[0] = fp[1] - fp[0]
            if(fa[0] * fa[1] != f0**2):
                famincalc = f0**2 / fa[1]
                famaxcalc = f0**2 / fa[0]
                if(famincalc > fa[0]):
                    fa[0] = famincalc
                elif(famaxcalc < fa[1]):
                    fa[1] = famaxcalc
            bw[1] = fa[1] - fa[0]

        elif(self.tipo_box.currentIndex() == Filter.BAND_REJECT):
            f0 = np.sqrt(fa[0] * fa[1])
            bw[0] = fa[1] - fa[0]
            if(fp[0] * fp[1] != f0**2):
                fpmincalc = f0**2 / fp[1]
                fpmaxcalc = f0**2 / fp[0]
                if(fpmincalc > fp[0]):
                    fp[0] = fpmincalc
                elif(fpmaxcalc < fp[1]):
                    fp[1] = fpmaxcalc    
            bw[1] = fp[1] - fp[0]

        self.fa_min_box.setValue(fa[0])
        self.fa_max_box.setValue(fa[1])
        self.fp_min_box.setValue(fp[0])
        self.fp_max_box.setValue(fp[1])
        self.f0_box.setValue(f0)
        self.bw_min_box.setValue(bw[0])
        self.bw_max_box.setValue(bw[1])

    def changeSelectedFilter(self):
        newFilter = self.buildFilterFromParams()
        valid, msg = newFilter.validate()
        if not valid:
            self.pmptd.setErrorMsg(msg)
            self.pmptd.setFocus()
            return
        temp_datalines = self.selected_dataset_data.datalines
        ds = Dataset('', self.filtername_box.text(), newFilter)
        ds.datalines = temp_datalines
        ds.title = self.filtername_box.text()
        self.selected_dataset_widget.setText(self.filtername_box.text())
        self.selfil_cb.setItemData(self.selfil_cb.currentIndex(), ds)
        self.selfil_cb.setItemText(self.selfil_cb.currentIndex(), ds.title)
        self.stages_selfil_cb.setItemData(self.stages_selfil_cb.currentIndex(), ds)
        self.stages_selfil_cb.setItemText(self.selfil_cb.currentIndex(), ds.title)
        self.selected_dataset_widget.setData(Qt.UserRole, ds)
        self.filters[self.selfil_cb.currentIndex()] = ds
        self.populateSelectedDatasetDetails(self.selected_dataset_widget, None)

    def updateFilterParametersAvailable(self):
        if self.tipo_box.currentIndex() == Filter.LOW_PASS or self.tipo_box.currentIndex() == Filter.HIGH_PASS:
            for i in range(Filter.LEGENDRE + 1):
                self.aprox_box.model().item(i).setEnabled(True)
                self.compareapprox_cb.model().item(i).setEnabled(True)
            for i in range(Filter.BESSEL, Filter.GAUSS + 1):
                self.aprox_box.model().item(i).setEnabled(True)
                self.compareapprox_cb.model().item(i).setEnabled(True)
            if not self.aprox_box.model().item(self.aprox_box.currentIndex()).isEnabled():
                self.aprox_box.setCurrentIndex(Filter.BUTTERWORTH)
                self.compareapprox_cb.setCurrentIndex(Filter.BUTTERWORTH)
            self.updateComparisonAproxOptions(self.aprox_box.currentIndex())
            self.define_with_box.setVisible(False)
            self.label_definewith.setVisible(False)
            self.ap_box.setVisible(True)
            self.label_ap.setVisible(True)
            self.aa_box.setVisible(True)
            self.label_aa.setVisible(True)
            self.fp_box.setVisible(True)
            self.label_fp.setVisible(True)
            self.fa_box.setVisible(True)
            self.label_fa.setVisible(True)
            self.fa_min_box.setVisible(False)
            self.symmetrize_btn.setVisible(False)
            self.label_famin.setVisible(False)
            self.fa_max_box.setVisible(False)
            self.label_famax.setVisible(False)
            self.fp_min_box.setVisible(False)
            self.label_fpmin.setVisible(False)
            self.fp_max_box.setVisible(False)
            self.label_fpmax.setVisible(False)
            self.f0_box.setVisible(False)
            self.label_f0.setVisible(False)
            self.bw_min_box.setVisible(False)
            self.label_bwmin.setVisible(False)
            self.bw_max_box.setVisible(False)
            self.label_bwmax.setVisible(False)
            self.tau0_box.setVisible(False)
            self.label_tau0.setVisible(False)
            self.frg_box.setVisible(False)
            self.label_fRG.setVisible(False)
            self.tol_box.setVisible(False)
            self.label_tolerance.setVisible(False)

        elif self.tipo_box.currentIndex() == Filter.BAND_PASS or self.tipo_box.currentIndex() == Filter.BAND_REJECT:
            for i in range(Filter.LEGENDRE + 1):
                self.aprox_box.model().item(i).setEnabled(True)
                self.compareapprox_cb.model().item(i).setEnabled(True)
            for i in range(Filter.BESSEL, Filter.GAUSS + 1):
                self.aprox_box.model().item(i).setEnabled(True)
                self.compareapprox_cb.model().item(i).setEnabled(True)
            if not self.aprox_box.model().item(self.aprox_box.currentIndex()).isEnabled():
                self.aprox_box.setCurrentIndex(Filter.BUTTERWORTH)
                self.compareapprox_cb.setCurrentIndex(Filter.BUTTERWORTH)
            self.define_with_box.setVisible(True)
            self.label_definewith.setVisible(True)
            self.ap_box.setVisible(True)
            self.label_ap.setVisible(True)
            self.aa_box.setVisible(True)
            self.label_aa.setVisible(True)
            self.fp_box.setVisible(False)
            self.label_fp.setVisible(False)
            self.fa_box.setVisible(False)
            self.label_fa.setVisible(False)
            self.tau0_box.setVisible(False)
            self.label_tau0.setVisible(False)
            self.frg_box.setVisible(False)
            self.label_fRG.setVisible(False)
            self.tol_box.setVisible(False)
            self.label_tolerance.setVisible(False)

            if self.define_with_box.currentIndex() == Filter.TEMPLATE_FREQS:
                self.fa_min_box.setVisible(True)
                self.label_famin.setVisible(True)
                self.fa_max_box.setVisible(True)
                self.label_famax.setVisible(True)
                self.fp_min_box.setVisible(True)
                self.label_fpmin.setVisible(True)
                self.fp_max_box.setVisible(True)
                self.label_fpmax.setVisible(True)
                self.f0_box.setVisible(False)
                self.label_f0.setVisible(False)
                self.bw_min_box.setVisible(False)
                self.label_bwmin.setVisible(False)
                self.bw_max_box.setVisible(False)
                self.label_bwmax.setVisible(False)
                self.symmetrize_btn.setVisible(True)

            if self.define_with_box.currentIndex() == Filter.F0_BW:
                self.fa_min_box.setVisible(False)
                self.label_famin.setVisible(False)
                self.fa_max_box.setVisible(False)
                self.label_famax.setVisible(False)
                self.fp_min_box.setVisible(False)
                self.label_fpmin.setVisible(False)
                self.fp_max_box.setVisible(False)
                self.label_fpmax.setVisible(False)
                self.f0_box.setVisible(True)
                self.label_f0.setVisible(True)
                self.bw_min_box.setVisible(True)
                self.label_bwmin.setVisible(True)
                self.bw_max_box.setVisible(True)
                self.label_bwmax.setVisible(True)
                self.symmetrize_btn.setVisible(False)
        
        elif self.tipo_box.currentIndex() == Filter.GROUP_DELAY:
            for i in range(Filter.LEGENDRE + 1):
                self.aprox_box.model().item(i).setEnabled(False)
                self.compareapprox_cb.model().item(i).setEnabled(False)
                self.compareapprox_cb.model().item(i).setChecked(False)
            for i in range(Filter.BESSEL, Filter.GAUSS + 1):
                self.aprox_box.model().item(i).setEnabled(True)
                self.compareapprox_cb.model().item(i).setEnabled(True)
            if not self.aprox_box.model().item(self.aprox_box.currentIndex()).isEnabled():
                self.aprox_box.setCurrentIndex(Filter.BESSEL)
                self.compareapprox_cb.setCurrentIndex(Filter.BESSEL)
            
            self.define_with_box.setVisible(False)
            self.label_definewith.setVisible(False)
            self.ap_box.setVisible(False)
            self.label_ap.setVisible(False)
            self.aa_box.setVisible(False)
            self.label_aa.setVisible(False)
            self.fp_box.setVisible(False)
            self.label_fp.setVisible(False)
            self.fa_box.setVisible(False)
            self.label_fa.setVisible(False)
            self.fa_min_box.setVisible(False)
            self.label_famin.setVisible(False)
            self.fa_max_box.setVisible(False)
            self.label_famax.setVisible(False)
            self.fp_min_box.setVisible(False)
            self.label_fpmin.setVisible(False)
            self.fp_max_box.setVisible(False)
            self.label_fpmax.setVisible(False)
            self.f0_box.setVisible(False)
            self.label_f0.setVisible(False)
            self.bw_min_box.setVisible(False)
            self.label_bwmin.setVisible(False)
            self.bw_max_box.setVisible(False)
            self.label_bwmax.setVisible(False)
            self.tau0_box.setVisible(True)
            self.label_tau0.setVisible(True)
            self.frg_box.setVisible(True)
            self.label_fRG.setVisible(True)
            self.tol_box.setVisible(True)
            self.label_tolerance.setVisible(True)
            self.symmetrize_btn.setVisible(False)

    def condition_canvas(self, canvas, xlabel, ylabel, xscale='linear', yscale='linear', grid=True):
        canvas.ax.clear()
        canvas.ax.grid(grid, which="both", linestyle=':')
        canvas.ax.set_xlabel(xlabel)
        canvas.ax.set_ylabel(ylabel)
        canvas.ax.set_xscale(xscale)
        canvas.ax.set_yscale(yscale)
        canvas.ax.xaxis.label.set_size(self.plt_labelsize_sb.value())
        canvas.ax.yaxis.label.set_size(self.plt_labelsize_sb.value())
        for label in (canvas.ax.get_xticklabels() + canvas.ax.get_yticklabels()):
            label.set_fontsize(self.plt_ticksize_sb.value())

    def updateFilterPlots(self):
        random_colors = np.copy(DEFAULT_COLORS)
        np.random.shuffle(random_colors)
        if(self.actionColorsCanonical.isChecked()):
            color_arr = CANON_COLORS
        else:
            color_arr = random_colors
        curraprox = self.aprox_box.currentIndex()
        # print("Update filter plots")
        # return
        if(not isinstance(self.selected_dataset_data, Dataset)): return
        if(self.filterZerCursor):
            for sel in self.filterZerCursor.selections:
                self.filterZerCursor.remove_selection(sel)

        if self.filterPoleCursor :
            for sel in self.filterPoleCursor.selections:
                self.filterPoleCursor.remove_selection(sel)
        self.poles_acum = []
        self.zeros_acum = []

        attcanvas = self.fplot_att.canvas
        magcanvas = self.fplot_mag.canvas
        phasecanvas = self.fplot_phase.canvas
        groupdelaycanvas = self.fplot_gd.canvas
        stepcanvas = self.fplot_step.canvas
        impulsecanvas = self.fplot_impulse.canvas
        self.condition_canvas(attcanvas, self.FREQ_LABEL, 'Atenuación [dB]')
        self.condition_canvas(magcanvas, self.FREQ_LABEL, 'Magnitud [dB]', 'log')
        self.condition_canvas(phasecanvas, self.FREQ_LABEL, 'Fase [$^o$]', 'log')
        phasecanvas.ax.yaxis.set_major_locator(ticker.MaxNLocator(nbins='auto', steps=[1.8,2.25,4.5,9]))
        self.condition_canvas(groupdelaycanvas, self.FREQ_LABEL, 'Retardo de grupo [s]', 'log')
        self.condition_canvas(self.fplot_pz.canvas, '', '')
        self.condition_canvas(stepcanvas, 'Tiempo [s]', 'Respuesta [V]')
        self.condition_canvas(impulsecanvas, 'Tiempo [s]', 'Respuesta [V]')
        filtds = self.selected_dataset_data

        # print("Plots conditioned")

        tstep, stepres = signal.step(filtds.tf.tf_object, N=5000)
        timp, impres = signal.impulse(filtds.tf.tf_object, N=5000)
        
        z, p = filtds.origin.tf.getZP(self.use_hz)
        minf, maxf = self.getRelevantFrequencies(z, p)
        minval = minf/100
        maxval = maxf*100
        f,g,ph,gd = filtds.tf.getBode(start=np.log10(minval), stop=np.log10(maxval),db=True, use_hz=self.use_hz)
        gain_offset = 20*np.log10(filtds.origin.gain)
        magcanvas.ax.plot(f, g, label = str(filtds.origin), color=color_arr[curraprox])
        phasecanvas.ax.plot(f, ph, label = str(filtds.origin), color=color_arr[curraprox])
        groupdelaycanvas.ax.plot(f, gd, label = str(filtds.origin), color=color_arr[curraprox])
        stepcanvas.ax.plot(tstep, stepres, label = str(filtds.origin), color=color_arr[curraprox])
        impulsecanvas.ax.plot(timp, impres, label = str(filtds.origin), color=color_arr[curraprox])

        magcanvas.ax.set_xlim([minval, maxval])
        phasecanvas.ax.set_xlim([minval, maxval])

        ap = filtds.origin.ap_dB - gain_offset
        aa = filtds.origin.aa_dB - gain_offset
        
        # print("Plots plotted 1")
        minp, maxp = self.getRelevantFrequencies(z, p)
        xmin = 0
        xmax = 0
        ymax = aa*2
        patches = []
        if filtds.origin.filter_type == Filter.LOW_PASS:
            fp = filtds.origin.wp * self.SING_B_TO_F
            fa = filtds.origin.wa * self.SING_B_TO_F
            deltaf = (fa - fp)/2
            xmax = fa + deltaf
            xmax = np.max([maxp, fa])*1.4
            xmin = np.max([0, fp - deltaf])
            xmin = 0

            attcanvas.ax.fill_between([0, fp], [ap, ap], ymax, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.fill_between([fa, maxp*100], [aa, aa], -gain_offset, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.set_ylim([-gain_offset, ymax])
            if(filtds.origin.denorm == 0):
                patches.append(Circle((0, 0), fp, fill=False, linestyle=':', alpha=0.15))
            elif(filtds.origin.denorm == 100):
                patches.append(Circle((0, 0), fa, fill=False, linestyle=':', alpha=0.15))

        elif filtds.origin.filter_type == Filter.HIGH_PASS:
            fp = filtds.origin.wp * self.SING_B_TO_F
            fa = filtds.origin.wa * self.SING_B_TO_F
            deltaf = (fp - fa)/2
            xmax = fp + deltaf
            xmax = np.max([fp, maxp])*1.4
            xmin = np.max([0, fa - deltaf])
            xmin = 0

            attcanvas.ax.fill_between([fp, maxp*100], [ap, ap], ymax, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.fill_between([0, fa], [aa, aa], -gain_offset, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.set_ylim([-gain_offset, ymax])
            if(filtds.origin.denorm == 0):
                patches.append(Circle((0, 0), fp, fill=False, linestyle=':', alpha=0.15))
            elif(filtds.origin.denorm == 100):
                patches.append(Circle((0, 0), fa, fill=False, linestyle=':', alpha=0.15))

        elif filtds.origin.filter_type == Filter.BAND_PASS:
            fp = [w * self.SING_B_TO_F for w in filtds.origin.wp]
            fa = [w * self.SING_B_TO_F for w in filtds.origin.wa]
            f0 = self.SING_B_TO_F * filtds.origin.w0
            reqfa = [w * self.SING_B_TO_F for w in filtds.origin.reqwa] if self.define_with_box.currentIndex() == Filter.TEMPLATE_FREQS else fa
            deltaf = (fa[1] - fa[0])/2
            xmax = fa[1] + deltaf
            xmax = np.max([xmax, maxp])*1.4
            xmin = np.max([0, fa[0] - deltaf])
            xmin = 0
            
            attcanvas.ax.fill_between([0,  reqfa[0]], [aa, aa], -gain_offset, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.fill_between([reqfa[1], maxp*100 ], [aa, aa], -gain_offset, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            
            if self.define_with_box.currentIndex() == Filter.TEMPLATE_FREQS:
                if(fa[0] != reqfa[0]):
                    attcanvas.ax.fill_between([fa[0],  reqfa[0]], [aa, aa], -gain_offset, facecolor=ADD_TEMPLATE_FACE_COLOR, edgecolor=ADD_TEMPLATE_EDGE_COLOR, hatch='//', linewidth=0)
                elif(fa[1] != reqfa[1]):
                    attcanvas.ax.fill_between([reqfa[1], fa[1] ], [aa, aa], -gain_offset, facecolor=ADD_TEMPLATE_FACE_COLOR, edgecolor=ADD_TEMPLATE_EDGE_COLOR, hatch='//', linewidth=0)
                else:
                    pass
            attcanvas.ax.fill_between([fp[0], fp[1]], [ap, ap], ymax, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.set_ylim([-gain_offset, ymax])
            
            if(filtds.origin.denorm == 0):
                mintransband = np.min([fp[0]-fa[0], fa[1]-fp[1]])
                deltafp = fp[1]-fp[0]
                bpmeritfig = deltafp/mintransband
                if(bpmeritfig <= 3):
                    patches.append(Circle((0, 0), f0, fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, f0), np.abs(fp[0] - fp[1])/2, fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, -f0), np.abs(fp[0] - fp[1])/2, fill=False, linestyle=':', alpha=0.15))
                else:
                    patches.append(Circle((0, 0), fp[0], fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, 0), fp[1], fill=False, linestyle=':', alpha=0.15))



        elif filtds.origin.filter_type == Filter.BAND_REJECT:
            fp = [w * self.SING_B_TO_F for w in filtds.origin.wp]
            reqfp = [w * self.SING_B_TO_F for w in filtds.origin.reqwp] if self.define_with_box.currentIndex() == Filter.TEMPLATE_FREQS else fp
            fa = [w * self.SING_B_TO_F for w in filtds.origin.wa]
            f0 = self.SING_B_TO_F * filtds.origin.w0
            deltaf = (fp[1] - fp[0])/2
            xmax = fp[1] + deltaf
            xmax = np.max([xmax, maxp])*1.4
            xmin = np.max([0, fp[0] - deltaf])
            xmin = 0
            
            attcanvas.ax.fill_between([0,  reqfp[0]], [ap, ap], ymax, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.fill_between([reqfp[1], maxp*100 ], [ap, ap], ymax, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            if self.define_with_box.currentIndex() == Filter.TEMPLATE_FREQS:
                if(fp[0] != reqfp[0]):
                    attcanvas.ax.fill_between([fp[0], reqfp[0]], [ap, ap], ymax, facecolor='#555555', edgecolor='#121212', hatch='//', linewidth=0)
                elif(fp[1] != reqfp[1]):
                    attcanvas.ax.fill_between([reqfp[1], fp[1]], [ap, ap], ymax, facecolor='#555555', edgecolor='#121212', hatch='//', linewidth=0)
                else:
                    print("WTF")
            attcanvas.ax.fill_between([fa[0], fa[1]], [aa, aa], -gain_offset, facecolor=TEMPLATE_FACE_COLOR, edgecolor=TEMPLATE_EDGE_COLOR, hatch='\\', linewidth=0)
            attcanvas.ax.set_ylim([-gain_offset, ymax])
            
            if(filtds.origin.denorm == 0):
                mintransband = np.min([fa[0]-fp[0], fp[1]-fa[1]])
                deltafa = fa[1]-fa[0]
                brmeritfig = deltafa/mintransband
                if(brmeritfig <= 3):
                    patches.append(Circle((0, 0), f0, fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, f0), np.abs(fp[0] - fp[1])/2, fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, -f0), np.abs(fp[0] - fp[1])/2, fill=False, linestyle=':', alpha=0.15))
                else:
                    patches.append(Circle((0, 0), fp[0], fill=False, linestyle=':', alpha=0.15))
                    patches.append(Circle((0, 0), fp[1], fill=False, linestyle=':', alpha=0.15))
        
        elif filtds.origin.filter_type == Filter.GROUP_DELAY:
            frg = filtds.origin.wrg * self.SING_B_TO_F
            xmax = 2 * frg
            xmin = 0
            groupdelaycanvas.ax.fill_between([0,  frg], [filtds.origin.tau0, filtds.origin.tau0], filtds.origin.tau0*(1 - filtds.origin.gamma/100), facecolor=ADD_TEMPLATE_FACE_COLOR, edgecolor=ADD_TEMPLATE_EDGE_COLOR, hatch='//', linewidth=0)
        attcanvas.ax.set_xlim(xmin, xmax)
        fa, ga, pa = filtds.origin.tf.getBodeMagFast(linear=True, start=0.5*xmin, stop=2*xmax, db=True, num=10000, use_hz=self.use_hz)
        with np.errstate(divide='ignore'): 
            attcanvas.ax.plot(fa, -ga, label = str(filtds.origin), color=color_arr[curraprox])

        # print("Plots plotted 2")
        self.fplot_pz.canvas.ax.axhline(0, color="black", alpha=0.1)
        self.fplot_pz.canvas.ax.axvline(0, color="black", alpha=0.1)
        minf, maxf = self.getRelevantFrequencies(z, p)
        zx = z.real
        zy = z.imag
        px = p.real
        py = p.imag
        zeroes = self.fplot_pz.canvas.ax.scatter(zx, zy, marker='o', label = str(filtds.origin), color=color_arr[curraprox])
        self.fplot_pz.canvas.ax.set_xlabel(self.PZ_XLABEL)
        self.fplot_pz.canvas.ax.set_ylabel(self.PZ_YLABEL)
        self.zeros_acum = np.append(self.zeros_acum, zeroes)

        # print("Plots plotted 3")
        maxf2 = 0
        for helper in filtds.origin.helperFilters:
            fa, ga, pa = helper.tf.getBodeMagFast(linear=True, start=0.5*xmin, stop=2*xmax, db=True, num=10000, use_hz=self.use_hz)
            attcanvas.ax.plot(fa, -ga, label = str(helper), color=color_arr[helper.approx_type])
            f,g,ph,gd = helper.tf.getBode(start=np.log10(minval), stop=np.log10(maxval),db=True, use_hz=self.use_hz)
            z, p = helper.tf.getZP(self.use_hz)
            p = np.append(p, [minf, maxf])
            minf2, maxf2 = self.getRelevantFrequencies(z, p)

            tstep, stepres = signal.step(helper.tf.tf_object, N=5000)
            timp, impres = signal.impulse(helper.tf.tf_object, N=5000)
            magcanvas.ax.plot(f, g, label = str(helper), color=color_arr[helper.approx_type])
            phasecanvas.ax.plot(f, ph, label = str(helper), color=color_arr[helper.approx_type])
            groupdelaycanvas.ax.plot(f, gd, label = str(helper), color=color_arr[helper.approx_type])
            stepcanvas.ax.plot(tstep, stepres, label = str(helper), color=color_arr[helper.approx_type])
            impulsecanvas.ax.plot(timp, impres, label = str(helper), color=color_arr[helper.approx_type])
            zeroes = self.fplot_pz.canvas.ax.scatter(z.real, z.imag, marker='o', label = str(helper), color=color_arr[helper.approx_type])
            self.zeros_acum = np.append(self.zeros_acum, zeroes)

        self.fplot_pz.canvas.ax.set_prop_cycle(None) # reset colors
        if(self.cb_frelcirc.isChecked()):
            for patch in patches:
                self.fplot_pz.canvas.ax.add_patch(patch)
        poles = self.fplot_pz.canvas.ax.scatter(px, py, marker='x', color=color_arr[curraprox])
        self.poles_acum = np.append(self.poles_acum, poles)
        
        for helper in filtds.origin.helperFilters:
            z, p = helper.tf.getZP(self.use_hz)
            poles = self.fplot_pz.canvas.ax.scatter(p.real, p.imag, marker='x', color=color_arr[helper.approx_type])
            self.poles_acum = np.append(self.poles_acum, poles)    
        self.filterPoleCursor = cursor(self.poles_acum, multiple=True, highlight=True)
        self.filterPoleCursor.connect("add", self.formatPoleAnnotation)
        self.filterZerCursor = cursor(self.zeros_acum, multiple=True, highlight=True)
        self.filterZerCursor.connect("add", self.formatZeroAnnotation)


        actualmax = max([maxf, maxf2])
        self.fplot_pz.canvas.ax.axis('equal')
        sizes = self.fplot_pz.canvas.ax.figure.get_size_inches()
        if(sizes[0] > sizes[1]):
            self.fplot_pz.canvas.ax.set_xlim(left=-actualmax*PZ_LIM_SCALING, right=actualmax*PZ_LIM_SCALING)
            self.fplot_pz.canvas.ax.set_ylim(bottom=-actualmax*PZ_LIM_SCALING, top=actualmax*PZ_LIM_SCALING)
        else:
            self.fplot_pz.canvas.ax.set_ylim(bottom=-actualmax*PZ_LIM_SCALING, top=actualmax*PZ_LIM_SCALING)
            self.fplot_pz.canvas.ax.set_xlim(left=-actualmax*PZ_LIM_SCALING, right=actualmax*PZ_LIM_SCALING)

        if(len(filtds.origin.helperFilters) > 0 and self.cb_flegends.isChecked()):
            attcanvas.ax.legend()
            magcanvas.ax.legend()
            phasecanvas.ax.legend()
            groupdelaycanvas.ax.legend()
            self.fplot_pz.canvas.ax.legend()
            stepcanvas.ax.legend()
            impulsecanvas.ax.legend()
        attcanvas.draw_idle()
        magcanvas.draw_idle()
        phasecanvas.draw_idle()
        groupdelaycanvas.draw_idle()
        
        self.fplot_pz.canvas.draw_idle()
        stepcanvas.draw_idle()
        impulsecanvas.draw_idle()

        self.redrawFilterPlotsArr = [True] * len(self.filterPlots)
        self.redrawFilterPlotsArr[self.tabWidget_2.currentIndex()] = False
        self.filterPlots[self.tabWidget_2.currentIndex()].canvas.draw_idle()
    
    def redrawFilterPlots(self, index):
        if(self.redrawFilterPlotsArr[index]):
            self.redrawFilterPlotsArr[index] = False
            self.filterPlots[index].canvas.draw_idle()
    def redrawStagePlots(self, index):
        if(self.redrawStagePlotsArr[index]):
            self.redrawStagePlotsArr[index] = False
            self.stagePlots[index].canvas.draw_idle()
        

    def updateFilterStages(self):
        self.stages_list.blockSignals(True)
        self.stages_list.clear()
        self.zeros_list.clear()
        self.poles_list.clear()
        self.remaining_gain_text.clear()
        self.total_filtdrloss_label.clear()
        if self.selected_dataset_data.type == 'filter':
            self.new_stage_btn.setEnabled(True)
            self.remove_stage_btn.setEnabled(True)
            zeros, poles = self.selected_dataset_data.origin.tf.getZP(False)
            
            remzeros = np.copy(np.array(self.selected_dataset_data.origin.remainingZeros))
            for p in poles:
                qlwt = QListWidgetItem()
                qlwt.setData(Qt.UserRole, p)
                qlwt.setText("{0:.3g} ω0={1:.3g} Q={2:.2g}".format(p, np.abs(p), self.calcQ(p)))
                if(p not in np.array(self.selected_dataset_data.origin.remainingPoles)):
                    qlwt.setFlags(Qt.ItemFlag.NoItemFlags)
                self.poles_list.addItem(qlwt)
            for z in zeros:
                qlwt = QListWidgetItem()
                qlwt.setData(Qt.UserRole, z)
                qlwt.setText("{0:.3g}j".format(np.imag(z)))
                iz = np.where(remzeros == z)
                if(len(iz[0]) > 0):
                    remzeros = np.delete(remzeros, iz[0][0])
                else:
                    qlwt.setFlags(Qt.ItemFlag.NoItemFlags)
                self.zeros_list.addItem(qlwt)
            for implemented_stage in self.selected_dataset_data.origin.stages:
                qlwt = QListWidgetItem()
                qlwt.setData(Qt.UserRole, Dataset(origin=implemented_stage))
                qlwt.setText(stage_to_str(implemented_stage, 1))
                self.stages_list.addItem(qlwt)
            self.remaining_gain_text.setText("{:.2g} dB".format(20*np.log10(self.selected_dataset_data.origin.remainingGain)))
            self.total_filtdrloss_label.setText("{:.2g} dB".format(self.selected_dataset_data.origin.getStagesDynamicRangeLoss()))
            self.stage_gain_box.setValue(20*np.log10(self.selected_dataset_data.origin.remainingGain))
        else:  
            self.new_stage_btn.setEnabled(False)
            self.remove_stage_btn.setEnabled(False)
        
        self.stages_list.setCurrentRow(self.stages_list.count() - 1)
        self.stages_list.blockSignals(False)
        self.updateStagePlots()

    def stage_sel_changed(self):
        selected_pol_indexes = [sel.index for sel in self.stageCursorPol.selections]
        selected_zer_indexes = [sel.index for sel in self.stageCursorZer.selections]
        
        for x in range(self.poles_list.count()):
            pole = self.poles_list.item(x)
            poledata = pole.data(Qt.UserRole)
            if(pole.isSelected()):
                if(x not in selected_pol_indexes):
                    sel = Selection(
                        artist=self.splot_fpz.canvas.ax,
                        target_=[poledata.real, poledata.imag],
                        index=self.poles_list.row(pole),
                        dist=0,
                        annotation=None,
                        extras=[]
                    )
                    self.stageCursorPol.add_selection(sel)
            else:
                if(x in selected_pol_indexes):
                    for sel in self.stageCursorPol.selections:
                        if(sel.index == x):
                            self.stageCursorPol.remove_selection(sel)

        for x in range(self.zeros_list.count()):
            zero = self.zeros_list.item(x)
            zerodata = zero.data(Qt.UserRole)
            if(zero.isSelected()):
                if(x not in selected_zer_indexes):
                    sel = Selection(
                        artist=self.splot_fpz.canvas.ax,
                        target_=[zerodata.real, zerodata.imag],
                        index=self.zeros_list.row(zero),
                        dist=0,
                        annotation=None,
                        extras=[]
                    )
                    self.stageCursorZer.add_selection(sel)
            else:
                if(x in selected_zer_indexes):
                    for sel in self.stageCursorZer.selections:
                        if(sel.index == x):
                            self.stageCursorZer.remove_selection(sel)

    def updateNormalizationCb(self, z, p):
        auxarr = [len(z), len(p)]
        self.normalizationtype_cb.clear()
        if(auxarr == [0, 1]): # LP
            self.normalizationtype_cb.addItem(NORM_CB_DC)
        elif(auxarr == [1, 1]):
            if(np.abs(z[0]) < np.abs(p[0])):
                self.normalizationtype_cb.addItem(NORM_CB_HF)
            else:
                self.normalizationtype_cb.addItem(NORM_CB_DC)
        elif(auxarr == [0, 2]):
            self.normalizationtype_cb.addItem(NORM_CB_DC)
        elif(auxarr == [1, 2]):
            self.normalizationtype_cb.addItem(NORM_CB_BP)
        elif(auxarr == [2, 2]):
            if(np.isclose(np.abs(z[0]), 0, atol=1e-5)):
                self.normalizationtype_cb.addItem(NORM_CB_HF)
            else:
                self.normalizationtype_cb.addItem(NORM_CB_DC)
                self.normalizationtype_cb.addItem(NORM_CB_HF)


    def updateSelectedPolesFromPlot(self, s):
        self.poles_list.blockSignals(True)
        selected_pole_indexes = [sel.index for sel in self.stageCursorPol.selections]
        dont_add_to_list = False
        if(s.index in [sel.index for sel in self.stageCursorPol.selections if self.poles_list.item(sel.index).flags() == Qt.ItemFlag.NoItemFlags]):
            self.stageCursorPol.remove_selection(s)
            dont_add_to_list = True
        for x in range(self.poles_list.count()):
            if(not (x == s.index and dont_add_to_list)):
                self.poles_list.item(x).setSelected(x in selected_pole_indexes)
        self.updateNormalizationCb(
            [x.data(Qt.UserRole) for x in self.zeros_list.selectedIndexes()],
            [x.data(Qt.UserRole) for x in self.poles_list.selectedIndexes()]
        )
        self.poles_list.blockSignals(False)

    def updateSelectedZerosFromPlot(self, s):
        self.zeros_list.blockSignals(True)
        selected_zero_indexes = [sel.index for sel in self.stageCursorZer.selections]
        dont_add_to_list = False
        if(s.index in [sel.index for sel in self.stageCursorZer.selections if self.zeros_list.item(sel.index).flags() == Qt.ItemFlag.NoItemFlags]):
            self.stageCursorZer.remove_selection(s)
            dont_add_to_list = True
        for x in range(self.zeros_list.count()):
            if(not (x == s.index and dont_add_to_list)):
                self.zeros_list.item(x).setSelected(x in selected_zero_indexes)
        self.updateNormalizationCb(
            [x.data(Qt.UserRole) for x in self.zeros_list.selectedIndexes()],
            [x.data(Qt.UserRole) for x in self.poles_list.selectedIndexes()]
        )
        self.zeros_list.blockSignals(False)


    def addFilterStage(self):
        selected_poles = [x.data(Qt.UserRole) for x in self.poles_list.selectedIndexes()]
        selected_zeros = [x.data(Qt.UserRole) for x in self.zeros_list.selectedIndexes()]
        selected_gain = 10**(self.stage_gain_box.value()/20)

        selected_poles_idx = [x.row() for x in self.poles_list.selectedIndexes()]
        selected_zeros_idx = [x.row() for x in self.zeros_list.selectedIndexes()]
        selected_poles_idx.sort(reverse=True)
        selected_zeros_idx.sort(reverse=True)

        if self.selected_dataset_data.origin.addStage(selected_zeros, selected_poles, selected_gain, self.normalizationtype_cb.currentText(), self.cb_symdrl.isChecked(), False):
            for z in selected_zeros_idx:
                self.zeros_list.item(z).setFlags(Qt.ItemFlag.NoItemFlags)
            for p in selected_poles_idx:
                self.poles_list.item(p).setFlags(Qt.ItemFlag.NoItemFlags)
        
            [self.stageCursorPol.remove_selection(sel) for sel in self.stageCursorPol.selections]
            [self.stageCursorZer.remove_selection(sel) for sel in self.stageCursorZer.selections]
            qlwt = QListWidgetItem()
            qlwt.setData(Qt.UserRole, Dataset(origin=self.selected_dataset_data.origin.stages[-1]))
            qlwt.setText(stage_to_str(self.selected_dataset_data.origin.stages[-1], 1))
            self.stages_list.addItem(qlwt)
            self.remaining_gain_text.setText("{:.2g} dB".format(20*np.log10(self.selected_dataset_data.origin.remainingGain)))
            self.stage_gain_box.setValue(20*np.log10(self.selected_dataset_data.origin.remainingGain))
            self.total_filtdrloss_label.setText("{:.2g} dB".format(self.selected_dataset_data.origin.getStagesDynamicRangeLoss()))
            self.stages_list.setCurrentRow(self.stages_list.count() - 1)
            
            # self.updateStagePlots() # stages_list changes, so theres no need to do this
        else:
            print('Error al crear STAGE')

    def swapStagesUpwards(self):
        index = self.stages_list.currentRow()
        if(not(self.stages_list.count() > 1 and index != 0)):
            return
        self.selected_dataset_data.origin.swapStages(index, index - 1)
        self.stages_list.blockSignals(True)
        self.stages_list.clear()
        for stage in self.selected_dataset_data.origin.stages:
            qlwt = QListWidgetItem()
            qlwt.setData(Qt.UserRole, Dataset(origin=stage))
            qlwt.setText(stage_to_str(stage, 1))
            self.stages_list.addItem(qlwt)
        self.stages_list.blockSignals(False)
        self.stages_list.setCurrentRow(index - 1)

    def swapStagesDownwards(self):
        index = self.stages_list.currentRow()
        if(not(self.stages_list.count() > 1 and index != (self.stages_list.count() - 1))):
            return
        self.selected_dataset_data.origin.swapStages(index, index + 1)
        self.stages_list.blockSignals(True)
        self.stages_list.clear()
        for stage in self.selected_dataset_data.origin.stages:
            qlwt = QListWidgetItem()
            qlwt.setData(Qt.UserRole, Dataset(origin=stage))
            qlwt.setText(stage_to_str(stage, 1))
            self.stages_list.addItem(qlwt)
        self.stages_list.blockSignals(False)
        self.stages_list.setCurrentRow(index + 1)

    def orderStagesBySos(self):
        self.selected_dataset_data.origin.orderStagesBySos()
        self.stages_list.blockSignals(True)
        self.stages_list.clear()
        for stage in self.selected_dataset_data.origin.stages:
            qlwt = QListWidgetItem()
            qlwt.setData(Qt.UserRole, Dataset(origin=stage))
            qlwt.setText(stage_to_str(stage, 1))
            self.stages_list.addItem(qlwt)
        self.stages_list.blockSignals(False)
        self.updateFilterStages()

    def removeFilterStage(self):
        i = self.stages_list.currentRow()
        if i < 0:
            return
        
        self.selected_dataset_data.origin.removeStage(i)
        self.stages_list.blockSignals(True)
        self.stages_list.takeItem(i)
        self.stages_list.setCurrentRow(self.stages_list.count() - 1)
        self.stages_list.blockSignals(False)
        self.updateFilterStages()

    def formatPoleAnnotation(self, sel):
        forw = 'f' if self.use_hz else 'ω'
        sel.annotation.set_text('Pole {:d}\n{}={:.2f}\n{:.2f}+j{:.2f}\nQ={:.2f}'.format(sel.index, forw, np.sqrt(sel.target[0]**2 + sel.target[1]**2), sel.target[0], sel.target[1], self.calcQ(sel.target)))
    def formatPoleAnnotationW(self, sel):
        forw = 'ω'
        sel.annotation.set_text('Pole {:d}\n{}={:.2f}\n{:.2f}+j{:.2f}\nQ={:.2f}'.format(sel.index, forw, np.sqrt(sel.target[0]**2 + sel.target[1]**2), sel.target[0], sel.target[1], self.calcQ(sel.target)))

    def formatZeroAnnotation(self, sel):
        # if(True or sel.target[0] == 0 and sel.target[1] == 0):
        sel.annotation.set_text('Zero {:d}\n{:.2f}j'.format(sel.index, sel.target[1]))
        # else:
        #     sel.annotation.set_text('Zero {:d}\n{:.2f}+j{:.2f}\nQ={:.2f}'.format(sel.index, sel.target[0], sel.target[1], self.calcQ(sel.target)))

    def calcQ(self, singRe, singIm):
        return self.calcQ(singRe + singIm*1j)

    def calcQ(self, sing):
        if(isinstance(sing, (list, tuple, np.ndarray))):
            sing = sing[0] + sing[1]*1j
        if(sing.real == 0):
            return inf
        elif(sing.real > 0):
            return -1
        else:
            return np.abs(sing)/(- 2 * sing.real)

    def updateStagePlots(self):
        if(not isinstance(self.selected_dataset_data, Dataset)): return
    
        if(self.totalStagesZeroCursor):
            for sel in self.totalStagesZeroCursor.selections:
                self.totalStagesZeroCursor.remove_selection(sel)

        if(self.totalStagesPoleCursor):
            for sel in self.totalStagesPoleCursor.selections:
                self.totalStagesPoleCursor.remove_selection(sel)

        if(self.stageLonePoleCursor):
            for sel in self.stageLonePoleCursor.selections:
                self.stageLonePoleCursor.remove_selection(sel)

        if(self.stageLoneZeroCursor):
            for sel in self.stageLoneZeroCursor.selections:
                self.stageLoneZeroCursor.remove_selection(sel)

        self.redrawStagePlots = False
        smagcanvas = self.splot_sgain.canvas
        sphasecanvas = self.splot_sphase.canvas
        tgaincanvas = self.splot_tgain.canvas
        tphasecanvas = self.splot_tphase.canvas
        sstamagcanvas = self.splot_stagesmag.canvas
        simpcanvas = self.splot_simp.canvas
        sstepcanvas = self.splot_sstep.canvas

        self.condition_canvas(self.splot_pz.canvas, '$\sigma$ ($rad/s$)', '$j\omega$ ($rad/s$)')
        self.condition_canvas(self.splot_fpz.canvas, '$\sigma$ ($rad/s$)', '$j\omega$ ($rad/s$)')
        self.condition_canvas(self.splot_tpz.canvas, '$\sigma$ ($rad/s$)', '$j\omega$ ($rad/s$)')
        self.condition_canvas(smagcanvas, 'Frecuencia angular ($rad/s$)', 'Magnitud [dB]', 'log')
        self.condition_canvas(sphasecanvas, 'Frecuencia angular ($rad/s$)', 'Fase [$^o$]', 'log')
        self.condition_canvas(tgaincanvas, 'Frecuencia angular ($rad/s$)', 'Magnitud [dB]', 'log')
        self.condition_canvas(tphasecanvas, 'Frecuencia angular ($rad/s$)', 'Fase [$^o$]', 'log')
        self.condition_canvas(sstamagcanvas, 'Frecuencia angular ($rad/s$)', 'Magnitud [dB]', 'log')
        self.condition_canvas(simpcanvas, 'Tiempo [s]', 'Respuesta [V]')
        self.condition_canvas(sstepcanvas, 'Tiempo [s]', 'Respuesta [V]')
        sphasecanvas.ax.yaxis.set_major_locator(ticker.MaxNLocator(nbins='auto', steps=[4.5, 9]))
        tphasecanvas.ax.yaxis.set_major_locator(ticker.MaxNLocator(nbins='auto', steps=[4.5, 9]))

        zf, pf = self.selected_dataset_data.origin.tf.getZP(False)
        mint, maxt = self.getRelevantFrequencies(zf, pf)

        self.splot_fpz.canvas.ax.axis('equal')
        self.splot_fpz.canvas.ax.axhline(0, color="black", alpha=0.1)
        self.splot_fpz.canvas.ax.axvline(0, color="black", alpha=0.1)
        self.splot_fpz.canvas.ax.set_xlim(left=-maxt*PZ_LIM_SCALING, right=maxt*PZ_LIM_SCALING)
        self.splot_fpz.canvas.ax.set_ylim(bottom=-maxt*PZ_LIM_SCALING, top=maxt*PZ_LIM_SCALING)

        polcol = []
        zercol = []
        rps = np.array(self.selected_dataset_data.origin.remainingPoles)
        rzs = np.array(self.selected_dataset_data.origin.remainingZeros)
        for fp in pf:
            found = False
            for rp in rps:
                if(np.isclose(fp, rp)):
                    found = True
                    break
            polcol.append(POLE_COLOR if found else POLE_SEL_COLOR)
        for fz in zf:
            found = False
            for rz in rzs:
                if(np.isclose(fz, rz)): 
                    found = True
            zercol.append(ZERO_COLOR if found else ZERO_SEL_COLOR)


        # polcol = [POLE_COLOR if pole in np.array(self.selected_dataset_data.origin.remainingPoles)*self.SING_B_TO_F else POLE_SEL_COLOR for pole in pf]
        # zercol = [ZERO_COLOR if zero in np.array(self.selected_dataset_data.origin.remainingZeros)*self.SING_B_TO_F else ZERO_SEL_COLOR for zero in zf]
        zeroes_f = self.splot_fpz.canvas.ax.scatter(zf.real, zf.imag, c=zercol, marker='o')
        poles_f = self.splot_fpz.canvas.ax.scatter(pf.real, pf.imag, c=polcol, marker='x')
        self.stageCursorZer = cursor(zeroes_f, multiple=True, highlight=True)
        self.stageCursorZer.connect("add", self.formatZeroAnnotation)
        self.stageCursorZer.connect("add", self.updateSelectedZerosFromPlot)
        self.stageCursorZer.connect("remove", self.updateSelectedZerosFromPlot)
        self.stageCursorPol = cursor(poles_f, multiple=True, highlight=True)
        self.stageCursorPol.connect("add", self.formatPoleAnnotationW)
        self.stageCursorPol.connect("add", self.updateSelectedPolesFromPlot)
        self.stageCursorPol.connect("remove", self.updateSelectedPolesFromPlot)

        accumulated_ds = Dataset(origin=self.selected_dataset_data.origin.implemented_tf)

        w = accumulated_ds.data[0]['f'] * 2 * np.pi
        g = 20 * np.log10(np.abs(np.array(accumulated_ds.data[0]['g'])))
        ph = accumulated_ds.data[0]['ph']
        tgaincanvas.ax.plot(w, g)
        sstamagcanvas.ax.plot(w, g, label="Total")
        tphasecanvas.ax.plot(w, ph)
        
        self.splot_tpz.canvas.ax.axis('equal')
        self.splot_tpz.canvas.ax.axhline(0, color="black", alpha=0.1)
        self.splot_tpz.canvas.ax.axvline(0, color="black", alpha=0.1)
        self.splot_tpz.canvas.ax.set_xlim(left=-maxt*PZ_LIM_SCALING, right=maxt*PZ_LIM_SCALING)
        self.splot_tpz.canvas.ax.set_ylim(bottom=-maxt*PZ_LIM_SCALING, top=maxt*PZ_LIM_SCALING)
        zt, pt = self.selected_dataset_data.origin.implemented_tf.getZP(False)
        
        zeroes_t = self.splot_tpz.canvas.ax.scatter(zt.real, zt.imag, c='#0000FF', marker='o')
        poles_t = self.splot_tpz.canvas.ax.scatter(pt.real, pt.imag, c='#FF0000', marker='x')
        self.totalStagesZeroCursor = cursor(zeroes_t, multiple=True, highlight=True)
        self.totalStagesZeroCursor.connect("add", self.formatZeroAnnotation)
        self.totalStagesPoleCursor = cursor(poles_t, multiple=True, highlight=True)
        self.totalStagesPoleCursor.connect("add", self.formatPoleAnnotationW)

        for i, stage in enumerate(self.selected_dataset_data.origin.stages):
            sw,sg, sph = stage.getBodeMagFast(start=np.log10(w[0]), stop=np.log10(w[-1]), num=5000, db=True, use_hz=False)
            sstamagcanvas.ax.plot(sw, sg, label="Etapa " + str(i), alpha=0.8)
        sstamagcanvas.ax.legend()

        if(self.stages_list.currentItem()):
            accumulated_ds = self.stages_list.currentItem().data(Qt.UserRole)

            w = accumulated_ds.data[0]['f'] * 2 * np.pi
            g = 20 * np.log10(np.abs(np.array(accumulated_ds.data[0]['g'])))
            ph = accumulated_ds.data[0]['ph']
            z, p = accumulated_ds.origin.getZP(False)

            smagcanvas.ax.plot(w, g)
            sphasecanvas.ax.plot(w, ph)
      
            tstep, stepres = signal.step(accumulated_ds.origin.tf_object, N=5000)
            timp, impres = signal.impulse(accumulated_ds.origin.tf_object, N=5000)
            simpcanvas.ax.plot(timp, impres)
            sstepcanvas.ax.plot(tstep, stepres)

            (min, max) = self.getRelevantFrequencies(z, p)
            self.splot_pz.canvas.ax.axis('equal')
            self.splot_pz.canvas.ax.axhline(0, color="black", alpha=0.1)
            self.splot_pz.canvas.ax.axvline(0, color="black", alpha=0.1)
            self.splot_pz.canvas.ax.set_xlim(left=-max*PZ_LIM_SCALING, right=max*PZ_LIM_SCALING)
            self.splot_pz.canvas.ax.set_ylim(bottom=-max*PZ_LIM_SCALING, top=max*PZ_LIM_SCALING)

            zeroes_f = self.splot_pz.canvas.ax.scatter(z.real, z.imag, marker='o')
            poles_f = self.splot_pz.canvas.ax.scatter(p.real, p.imag, marker='x')

            self.stageLoneZeroCursor = cursor(zeroes_f)
            self.stageLoneZeroCursor.connect("add", self.formatZeroAnnotation)
            self.stageLonePoleCursor = cursor(poles_f)
            self.stageLonePoleCursor.connect("add", self.formatPoleAnnotation)
            self.si_info.setText(accumulated_ds.origin.getSOFilterType()[1])
        #     self.updatePossibleImplementations()
        # self.splot_pz.canvas.draw_idle()
        # smagcanvas.draw_idle()
        # sphasecanvas.draw_idle()
        self.redrawStagePlotsArr = [True] * len(self.stagePlots)
        self.redrawStagePlotsArr[self.tabWidget_3.currentIndex()] = False
        self.stagePlots[self.tabWidget_3.currentIndex()].canvas.draw_idle()

    def clearCanvas(self, canvas):
        canvas.ax.clear()
        canvas.ax.grid(True, which="both", linestyle=':')

    def openCaseDialog(self):
        self.csd.open()
        self.csd.populate(ds = self.selected_dataset_data)
        # self.tfd.tf_title.setFocus()

    def resolveCSDialog(self):
        first_case = int(self.csd.case_first_cb.currentIndex())
        last_case = int(self.csd.case_last_cb.currentIndex())
        casenum = len(self.selected_dataset_data.data)
        dli = 0
        for x in range(self.dataset_list.count()):
            ds = self.dataset_list.item(x).data(Qt.UserRole)
            dli = dli + len(self.datalines[x])
            if(ds.origin == self.selected_dataset_data.origin):
                break
        color_iter = 0
        for case in range(first_case, min(last_case + 1, casenum)):
            dl = self.selected_dataset_data.create_dataline(case)
            qlwt = QListWidgetItem()
            dl.plots = self.csd.case_render_cb.currentIndex()
            dl.transform = self.csd.case_transform_cb.currentIndex()
            dl.xsource = self.csd.case_xdata_cb.currentText()
            dl.xscale = self.csd.case_xscale_sb.value()
            dl.xoffset = self.csd.case_xoffset_sb.value()
            dl.ysource = self.csd.case_ydata_cb.currentText()
            dl.yscale = self.csd.case_yscale_sb.value()
            dl.yoffset = self.csd.case_yoffset_sb.value()
            if(self.csd.case_randomcol_rb.isChecked()):
                dl.color = ["#"+''.join([random.choice('0123456789ABCDEF') for i in range(6)])][0]
            elif(self.csd.case_presetcol_rb.isChecked()):
                colorpalette_i = self.csd.case_palettecol_cb.currentIndex()
                colorpalette = self.csd.COLOR_LIST[colorpalette_i]
                dl.color = colorpalette[color_iter]
                color_iter += 1
                if(color_iter == len(colorpalette)):
                    color_iter = 0
            else:
                dl.color = self.csd.color
            dl.linestyle = self.csd.case_style_cb.currentText()
            dl.linewidth = self.csd.case_linewidth_sb.value()
            dl.markerstyle = self.csd.case_marker_cb.currentText()
            dl.markersize = self.csd.case_markersize_sb.value()
            if(self.csd.case_inforname_rb.isChecked()):
                dstitle = self.selected_dataset_data.title 
                dscases = self.selected_dataset_data.casenames
                if(case < len(dscases)):
                    dl.name = dstitle + ' ' + dscases[case]
            qlwt.setText(dl.name)
            dl.name = dl.name if self.csd.case_addlegend_cb.isChecked() else '_' + dl.name
            qlwt.setData(Qt.UserRole, dl)
            self.dataline_list.insertItem(dli, qlwt)
            self.datalines[self.dataset_list.currentRow()].append(dl)
        self.updatePlots()

    def populateSelectedDatasetDetails(self, listitemwidget, qlistwidget):
        if(not listitemwidget):
            self.setDatasetControlsStatus(False)
            self.ds_title_edit.setText('')
            self.ds_casenum_lb.setText('0')
            self.ds_info_lb.setText('')
            return
        self.setDatasetControlsStatus(True)
        self.ds_title_edit.setText(listitemwidget.text())
        self.selected_dataset_widget = listitemwidget
        self.selected_dataset_data = listitemwidget.data(Qt.UserRole)
        isTF = self.selected_dataset_data.type in ['TF', 'filter']
        self.ds_poleszeros_btn.setEnabled(isTF)
        self.resp_btn.setEnabled(isTF)
        self.ds_casenum_lb.setText(str(len(self.selected_dataset_data.data)))
        self.ds_caseadd_btn.setVisible(len(self.selected_dataset_data.data) > 1)
        self.ds_info_lb.setText(self.selected_dataset_data.miscinfo)

        #relleno las cajas del filtro
        if(self.selected_dataset_data.type == 'filter'):
            self.populateSelectedFilterDetails()

    
    def populateSelectedFilterDetails(self, index=-2):
        if(index == -2):
            for i, fds in enumerate(self.filters):
                if(fds.origin == self.selected_dataset_data.origin):
                    self.selfil_cb.blockSignals(True)
                    self.stages_selfil_cb.blockSignals(True)
                    self.selfil_cb.setCurrentIndex(i)
                    self.stages_selfil_cb.setCurrentIndex(i)
                    self.selfil_cb.blockSignals(False)
                    self.stages_selfil_cb.blockSignals(False)
                    break
        elif(index != -1):
            if(index == self.selfil_cb.currentIndex()):
                filtds = self.selfil_cb.currentData()
                self.stages_selfil_cb.blockSignals(True)
                self.stages_selfil_cb.setCurrentIndex(index)
                self.stages_selfil_cb.blockSignals(False)
            else:
                filtds = self.stages_selfil_cb.currentData()
                self.selfil_cb.blockSignals(True)
                self.selfil_cb.setCurrentIndex(index)
                self.selfil_cb.blockSignals(False)
            if(self.selected_dataset_data.origin != filtds.origin):
                for x in range(self.dataset_list.count()):
                    item = self.dataset_list.item(x)
                    ds = item.data(Qt.UserRole)
                    if(ds.origin == filtds.origin):
                        self.dataset_list.setCurrentRow(x)
                        self.populateSelectedDatasetDetails(item, None)
                        return
        else:
            return
        self.filtername_box.setText(self.selected_dataset_data.title)
        self.tipo_box.setCurrentIndex(self.selected_dataset_data.origin.filter_type)
        self.aprox_box.setCurrentIndex(self.selected_dataset_data.origin.approx_type)
        self.compareapprox_cb.setCurrentIndexes(self.selected_dataset_data.origin.helper_approx)
        self.comp_N_box.setValue(self.selected_dataset_data.origin.helper_N)
        self.gain_box.setValue(20*np.log10(self.selected_dataset_data.origin.gain))
        self.aa_box.setValue(self.selected_dataset_data.origin.aa_dB)
        self.ap_box.setValue(self.selected_dataset_data.origin.ap_dB)
        self.N_label.setText(str(self.selected_dataset_data.origin.N))
        self.N_min_box.setValue(self.selected_dataset_data.origin.N_min)
        self.N_max_box.setValue(self.selected_dataset_data.origin.N_max)
        Qs = [self.calcQ(p) for p in self.selected_dataset_data.origin.tf.getZP()[1]]
        if(len(Qs) > 0):
            self.max_Q_label.setText("{:.2f}".format(max(Qs)))
        self.drloss_label.setText("{:.2f} dB".format(self.selected_dataset_data.origin.getDynamicRangeLoss()))
        self.define_with_box.setCurrentIndex(self.selected_dataset_data.origin.define_with)
        if self.selected_dataset_data.origin.filter_type in [Filter.BAND_PASS, Filter.BAND_REJECT]:
            self.fp_box.setValue(0)
            self.fa_box.setValue(0)
            fa = []
            fp = []
            if(self.selected_dataset_data.origin.filter_type == Filter.BAND_PASS):
                fp = [w * self.SING_B_TO_F for w in self.selected_dataset_data.origin.wp]
                fa = [w * self.SING_B_TO_F for w in self.selected_dataset_data.origin.reqwa]
            else:
                fp = [w * self.SING_B_TO_F for w in self.selected_dataset_data.origin.reqwp]
                fa = [w * self.SING_B_TO_F for w in self.selected_dataset_data.origin.wa]
            self.fa_min_box.setValue(fa[0])
            self.fa_max_box.setValue(fa[1])
            self.fp_min_box.setValue(fp[0])
            self.fp_max_box.setValue(fp[1])
            self.bw_max_box.setValue(self.selected_dataset_data.origin.bw[1] * self.SING_B_TO_F)
            self.bw_min_box.setValue(self.selected_dataset_data.origin.bw[0] * self.SING_B_TO_F)
            self.f0_box.setValue(self.selected_dataset_data.origin.w0 * self.SING_B_TO_F)
        elif self.selected_dataset_data.origin.filter_type in [Filter.LOW_PASS, Filter.HIGH_PASS]:
            self.fp_box.setValue(self.selected_dataset_data.origin.wp * self.SING_B_TO_F)
            self.fa_box.setValue(self.selected_dataset_data.origin.wa * self.SING_B_TO_F)
            self.fa_min_box.setValue(0)
            self.fa_max_box.setValue(0)
            self.fp_min_box.setValue(0)
            self.fp_max_box.setValue(0)
        else:
            self.fp_box.setValue(0)
            self.fa_box.setValue(0)
            self.fa_min_box.setValue(0)
            self.fa_max_box.setValue(0)
            self.fp_min_box.setValue(0)
            self.fp_max_box.setValue(0)
        self.updateFilterStages()
        self.updateFilterPlots()
        self.updateFilterParametersAvailable()

    def updateSelectedDatasetName(self):
        new_title = self.ds_title_edit.text()
        self.selected_dataset_widget.setText(new_title)
        self.selected_dataset_data.title = new_title
        if(self.selected_dataset_data.type == 'filter'):
            self.selfil_cb.setItemText(self.selfil_cb.currentIndex(), new_title)
            self.stages_selfil_cb.setItemText(self.stages_selfil_cb.currentIndex(), new_title)
            self.filtername_box.setText(new_title)

    def populateSelectedDatalineDetails(self, listitemwidget, qlistwidget):
        if(not listitemwidget):
            self.setDatalineControlsStatus(False)
            self.dl_name_edit.setText('')
            return
        self.setDatalineControlsStatus(True)
        self.dl_xscale_sb.blockSignals(True)
        self.dl_yscale_sb.blockSignals(True)
        self.dl_xoffset_sb.blockSignals(True)
        self.dl_yoffset_sb.blockSignals(True)
        self.dl_linewidth_sb.blockSignals(True)
        self.dl_markersize_sb.blockSignals(True)
        self.dl_savgol_wlen.blockSignals(True)
        self.dl_savgol_ord.blockSignals(True)

        self.selected_dataline_widget = listitemwidget
        self.selected_dataline_data = listitemwidget.data(Qt.UserRole)
        self.dl_name_edit.setText(self.selected_dataline_widget.text())
        self.dl_render_cb.setCurrentIndex(self.selected_dataline_data.plots)
        
        self.dl_xdata_cb.clear()
        self.dl_ydata_cb.clear()
        self.dl_xdata_cb.addItems(self.selected_dataline_data.dataset.fields)
        self.dl_ydata_cb.addItems(self.selected_dataline_data.dataset.fields)
        
        self.dl_transform_cb.setCurrentIndex(self.selected_dataline_data.transform)
        self.dl_xdata_cb.setCurrentText(self.selected_dataline_data.xsource)
        self.dl_xscale_sb.setValue(self.selected_dataline_data.xscale)
        self.dl_xoffset_sb.setValue(self.selected_dataline_data.xoffset)
        self.dl_ydata_cb.setCurrentText(self.selected_dataline_data.ysource)
        self.dl_yscale_sb.setValue(self.selected_dataline_data.yscale)
        self.dl_yoffset_sb.setValue(self.selected_dataline_data.yoffset)
        self.dl_color_edit.setText(self.selected_dataline_data.color)
        self.dl_style_cb.setCurrentText(self.selected_dataline_data.linestyle)
        self.dl_linewidth_sb.setValue(self.selected_dataline_data.linewidth)
        self.dl_marker_cb.setCurrentText(self.selected_dataline_data.markerstyle)
        self.dl_markersize_sb.setValue(self.selected_dataline_data.markersize)
        self.dl_color_label.setStyleSheet(f'background-color: {self.selected_dataline_data.color}')
        self.dl_savgol_wlen.setValue(self.selected_dataline_data.savgolwindow)
        self.dl_savgol_ord.setValue(self.selected_dataline_data.savgolord)
        
        self.dl_xscale_sb.blockSignals(False)
        self.dl_yscale_sb.blockSignals(False)
        self.dl_xoffset_sb.blockSignals(False)
        self.dl_yoffset_sb.blockSignals(False)
        self.dl_linewidth_sb.blockSignals(False)
        self.dl_markersize_sb.blockSignals(False)
        self.dl_savgol_wlen.blockSignals(False)
        self.dl_savgol_ord.blockSignals(False)

    def updateSelectedDataline(self):
        self.saveFile(True)
        if(not self.selected_dataline_widget):
            return
        new_name = self.dl_name_edit.text()
        self.selected_dataline_widget.setText(new_name)
        self.selected_dataline_data.name = new_name
        self.selected_dataline_data.plots = self.dl_render_cb.currentIndex()
        self.selected_dataline_data.transform = self.dl_transform_cb.currentIndex()
        self.selected_dataline_data.xsource = self.dl_xdata_cb.currentText()
        self.selected_dataline_data.xscale = self.dl_xscale_sb.value()
        self.selected_dataline_data.xoffset = self.dl_xoffset_sb.value()
        self.selected_dataline_data.ysource = self.dl_ydata_cb.currentText()
        self.selected_dataline_data.yscale = self.dl_yscale_sb.value()
        self.selected_dataline_data.yoffset = self.dl_yoffset_sb.value()
        self.selected_dataline_data.color = self.dl_color_edit.text()
        self.selected_dataline_data.linestyle = self.dl_style_cb.currentText()
        self.selected_dataline_data.linewidth = self.dl_linewidth_sb.value()
        self.selected_dataline_data.markerstyle = self.dl_marker_cb.currentText()
        self.selected_dataline_data.markersize = self.dl_markersize_sb.value()
        self.selected_dataline_data.savgolwindow = self.dl_savgol_wlen.value()
        self.selected_dataline_data.savgolord = self.dl_savgol_ord.value()
        self.populateSelectedDatalineDetails(self.selected_dataline_widget, None)
        self.updatePlots()

    
    def openColorPicker(self):
        dialog = QColorDialog(self)
        dialog.setCurrentColor(Qt.red)
        dialog.setOption(QColorDialog.ShowAlphaChannel)
        dialog.open()
        dialog.currentColorChanged.connect(self.updateDatalineColor)

    def updateDatalineColor(self, color):
        self.dl_color_edit.setText(color.name())
        self.dl_color_label.setStyleSheet(f'background-color: {color.name()}')
        self.selected_dataline_data.color = color.name()
        self.updatePlots()

    def setDatasetControlsStatus(self, enabled=True):
        self.ds_title_edit.setEnabled(enabled)
        self.ds_addline_btn.setEnabled(enabled)
        self.ds_caseadd_btn.setEnabled(enabled)
        self.ds_remove_btn.setEnabled(enabled)

    def setDatalineControlsStatus(self, enabled=True):
        self.dataline_gb.setEnabled(enabled)

    def getPlotFromIndex(self, plotnum):
        x = plotnum
        tab = 0
        for tab_plots in self.plots_canvases:
            if(x - len(tab_plots) >= 0):
                tab += 1
                x -= len(tab_plots)
            else:
                break
        return self.plots_canvases[tab][x]

    def autoscalePlots(self):
        processedCanvas = [x.canvas for x in self.plots_canvases[self.tabbing_plots.currentIndex()]]
        for canvas in processedCanvas:
            canvas.ax.margins(self.plt_marginx.value(), self.plt_marginy.value())
            canvas.ax.relim()
            canvas.ax.autoscale()
        self.updatePlots()

    def changeLabelSize(self):
        # plt.rcParams.update({'font.size': self.plt_labelsize_sb.value()})
        self.updatePlots()

    def updatePlots(self):
        self.saveFile(True)
        processedCanvas = [x.canvas for x in self.plots_canvases[self.tabbing_plots.currentIndex()]]
        for canvas in processedCanvas:
            plotlist = []
            for artist in canvas.ax.lines + canvas.ax.collections:
                artist.remove()
            for x in range(self.dataset_list.count()):
                ds = self.dataset_list.item(x).data(Qt.UserRole)
                for dl in ds.datalines:
                    dl_canvas = self.getPlotFromIndex(dl.plots).canvas
                    if(dl_canvas == canvas):
                        
                        for label in (canvas.ax.get_xticklabels() + canvas.ax.get_yticklabels()):
                            label.set_fontsize(self.plt_ticksize_sb.value())
                        canvas.ax.xaxis.label.set_size(self.plt_labelsize_sb.value())
                        canvas.ax.yaxis.label.set_size(self.plt_labelsize_sb.value())
                        canvas.ax.title.set_size(self.plt_titlesize_sb.value())

                        x, y = ds.get_datapoints(dl.xsource, dl.ysource, dl.casenum)

                        if(dl.transform == 1):
                            y = np.abs(y)
                        elif(dl.transform == 2):
                            y = np.angle(y, deg=True)
                        elif(dl.transform == 3):
                            y = np.unwrap(np.angle(y, deg=True), period=360)
                        elif(dl.transform == 4):
                            y = 20 * np.log10(y)
                        elif(dl.transform == 5):
                            y = 20 * np.log10(np.abs(y))
                        elif(dl.transform == 6):
                            y = np.unwrap(y, period=360)
                        else:
                            y = np.real(y)

                        if(dl.transform in [2,3,6]):
                            canvas.ax.yaxis.set_major_locator(ticker.MaxNLocator(nbins='auto', steps=[1.8,2.25,4.5,9]))
                        else:
                            canvas.ax.yaxis.set_major_locator(ticker.AutoLocator())

                        try:
                            savgolw = int(dl.savgolwindow)
                            if(savgolw <= len(x)):
                                savgolo = int(dl.savgolord)
                                y = y if savgolw <= savgolo else savgol_filter(y, savgolw, savgolo)
                        except ValueError:
                            pass

                        try:
                            line, = canvas.ax.plot(
                                x * dl.xscale + dl.xoffset,
                                y * dl.yscale + dl.yoffset,
                                linestyle = LINE_STYLES[dl.linestyle],
                                linewidth = dl.linewidth,
                                marker = MARKER_STYLES[dl.markerstyle],
                                markersize = dl.markersize,
                                color = dl.color,
                                label = dl.name,
                            )
                            if(dl.name != '' and dl.name[0] != '_'):
                                plotlist.append(line)
                        except ValueError:
                            self.statusbar.showMessage('Wrong data source matching', 2000)
            if(self.plt_legendpos.currentText() == 'None'):
                if(canvas.ax.get_legend()):
                    canvas.ax.get_legend().remove()
            else:
                canvas.ax.legend(handles=plotlist, fontsize=self.plt_legendsize_sb.value(), loc=self.plt_legendpos.currentIndex())
            if(self.plt_grid.isChecked()):
                canvas.ax.grid(True, which="both", linestyle=':')
            else:
                canvas.ax.grid(False, which="both")
                

            try:
                canvas.draw_idle()
            except ValueError:
                pass

    def showZPWindow(self):
        zeros = self.selected_dataset_data.zeros[0]
        poles = self.selected_dataset_data.poles[0]
        self.zpWindow = ZPWindow(zeros, poles, self.selected_dataset_data.title)
        self.zpWindow.show()

    def newFile(self):
        self.droppedFiles = []
        self.datasets = []
        self.datalines = []
        self.selected_dataset_widget = {}
        self.selected_dataline_widget = {}
        self.selected_dataset_data = {}
        self.selected_dataline_data = {}
        self.zpWindow = type(ZPWindow, (), {})()
        self.updateAll()
    
    def saveFile(self, noprompt=False):
        if(noprompt):
            filename = 'temp.fto'
        else:
            filename, _ = QFileDialog.getSaveFileName(self,"Save File", "","Filter tool file (*.fto)")
        if(not filename): return
        with open(filename, 'wb') as f:
            flat_plots_canvas = [item.canvas for sublist in self.plots_canvases for item in sublist]
            plots_data = []
            for canv in flat_plots_canvas:
                plots_data.append(canv.get_properties())
            general_config = {
                'labelsize_sb': self.plt_labelsize_sb.value(),
                'legendsize_sb': self.plt_legendsize_sb.value(),
                'ticksize_sb': self.plt_ticksize_sb.value(),
                'titlesize_sb': self.plt_titlesize_sb.value(),
                'legendpos': self.plt_legendpos.currentIndex(),
                'grid': self.plt_grid.isChecked(),
                'marginx': self.plt_marginx.value(),
                'marginy': self.plt_marginy.value()      
            }
            d = [self.datasets, self.datalines, plots_data, general_config]
            pickle.dump(d, f, pickle.HIGHEST_PROTOCOL)

    def loadFile(self):
        filename, _ = QFileDialog.getOpenFileName(self,"Select files", "","Filter tool file (*.fto)")
        if(not filename): return
        with open(filename, 'rb') as f:
            f.seek(0)
            self.datasets, self.datalines, plotdata, general_config = pickle.load(f)            
            self.plt_labelsize_sb.setValue(general_config['labelsize_sb'])
            self.plt_legendsize_sb.setValue(general_config['legendsize_sb'])
            self.plt_ticksize_sb.setValue(general_config['ticksize_sb'])
            self.plt_titlesize_sb.setValue(general_config['titlesize_sb'])
            self.plt_legendpos.setCurrentIndex(general_config['legendpos'])
            self.plt_grid.setChecked(general_config['grid'])
            self.plt_marginx.setValue(general_config['marginx'])
            self.plt_marginy.setValue(general_config['marginy'])  
            acc = 0   
            for s in self.plots_canvases:
                for p in s:
                    p.canvas.restore_properties(plotdata[acc])
                    acc += 1
            for ds in self.datasets:
                qlwt = QListWidgetItem()
                qlwt.setData(Qt.UserRole, ds)
                qlwt.setText(ds.title)
                self.dataset_list.addItem(qlwt)
                for dl in ds.datalines:
                    qlwt = QListWidgetItem()
                    qlwt.setData(Qt.UserRole, dl)
                    qlwt.setText(dl.name)
                    self.dataline_list.addItem(qlwt)
                if(ds.type == 'filter'):
                    self.filters.append(ds)
                    self.selfil_cb.blockSignals(True)
                    self.stages_selfil_cb.blockSignals(True)
                    self.selfil_cb.addItem(ds.title, ds)
                    self.stages_selfil_cb.addItem(ds.title, ds)
                    self.selfil_cb.blockSignals(False)
                    self.stages_selfil_cb.blockSignals(False)

            self.dataset_list.setCurrentRow(self.dataset_list.count() - 1)
            self.updateAll()
    
    def updateAll(self):
        self.updatePlots()
        self.updateSelectedDataline()
        self.updateFilterParametersAvailable()
    
    def getRelevantFrequencies(self, zeros, poles):
        singularitiesNorm = np.append(np.abs(zeros), np.abs(poles))
        singularitiesNormWithoutZeros = [s for s in singularitiesNorm if s != 0]
        if(len(singularitiesNormWithoutZeros) == 0):
            return (1, 1)
        return (np.min(singularitiesNormWithoutZeros), np.max(singularitiesNormWithoutZeros))
    
    def getMultiplierAndPrefix(self, val):
        multiplier = 1
        prefix = ''
        if(val < 1e-7):
            multiplier = 1e9
            prefix = 'n'
        elif(val < 1e-4):
            multiplier = 1e-6
            prefix = 'μ'
        elif(val < 1e-1):
            multiplier = 1e-3
            prefix = 'm'
        elif(val < 1e2):
            multiplier = 1
            prefix = ''
        elif(val < 1e5):
            multiplier = 1e3
            prefix = 'k'
        elif(val < 1e8):
            multiplier = 1e6
            prefix = 'M'
        elif(val > 1e11):
            multiplier = 1e9
            prefix = 'G'
        return (multiplier, prefix)

    def updatePossibleImplementations(self):
        if(not self.stages_list.currentItem()):
            return
        stage_tf = self.stages_list.currentItem().data(Qt.UserRole)
        stagetype, text = stage_tf.origin.getSOFilterType()
        arr = [False] * CellCalculator.IMPL_COUNT

        if(stagetype in [TF.LP1, TF.HP1]):
            arr[CellCalculator.PASSIVERC] = True
            arr[CellCalculator.PASSIVERLC] = False
            arr[CellCalculator.INTEGDERIV] = True
            arr[CellCalculator.SALLENKEY] = False
            arr[CellCalculator.RAUCH] = False
            arr[CellCalculator.DOUBLET] = False
            arr[CellCalculator.KHN] = False
            arr[CellCalculator.SEDRA] = False
            arr[CellCalculator.ACKERBERG] = False
            arr[CellCalculator.TOWTHOMAS] = False
            arr[CellCalculator.FLEISCHERTOW] = False
        else:
            arr[CellCalculator.INTEGDERIV] = False
            arr[CellCalculator.FLEISCHERTOW] = True
            if(stagetype in [TF.LP2, TF.HP2]):
                arr[CellCalculator.PASSIVERC] = True
                arr[CellCalculator.PASSIVERLC] = True
                arr[CellCalculator.SALLENKEY] = True
                arr[CellCalculator.RAUCH] = True
                arr[CellCalculator.DOUBLET] = True
                arr[CellCalculator.SEDRA] = True
                arr[CellCalculator.ACKERBERG] = stagetype == TF.LP2
                arr[CellCalculator.KHN] = True
                arr[CellCalculator.TOWTHOMAS] = stagetype == TF.LP2
            elif(stagetype == TF.BP):
                arr[CellCalculator.PASSIVERC] = stage_tf.gain <= 1 and stage_tf.getPoleQ() <= 1/3 # hay que ver bien el Q!!!
                arr[CellCalculator.PASSIVERLC] = True
                arr[CellCalculator.SALLENKEY] = False
                arr[CellCalculator.RAUCH] = True
                arr[CellCalculator.DOUBLET] = False
                arr[CellCalculator.SEDRA] = False
                arr[CellCalculator.ACKERBERG] = True
                arr[CellCalculator.KHN] = True
                arr[CellCalculator.TOWTHOMAS] = True
            elif(stagetype in [TF.BR, TF.HPN, TF.LPN]):
                arr[CellCalculator.PASSIVERC] = stage_tf.gain <= 1 and stage_tf.getPoleQ() < 1/3 # hay que ver bien el Q!!!
                arr[CellCalculator.PASSIVERLC] = True
                arr[CellCalculator.SALLENKEY] = False
                arr[CellCalculator.RAUCH] = False
                arr[CellCalculator.DOUBLET] = False
                arr[CellCalculator.SEDRA] = False
                arr[CellCalculator.ACKERBERG] = False
                arr[CellCalculator.KHN] = False # Por ahora!
                arr[CellCalculator.TOWTHOMAS] = False
        for i in range(CellCalculator.IMPL_COUNT):
            self.si_type_cb.model().item(i).setEnabled(arr[i])
        # f = accumulated_ds.data[0]['f']
        # g = accumulated_ds.data[0]['g']
        # ph = accumulated_ds.data[0]['ph']
        # z, p = accumulated_ds.origin.getZP(self.use_hz)

        # gline, = smagcanvas.ax.plot(f, g)
        # phline, = sphasecanvas.ax.plot(f, ph)

        # (min, max) = self.getRelevantFrequencies(z, p)
        # self.splot_pz.canvas.ax.axis('equal')
        # self.splot_pz.canvas.ax.axhline(0, color="black", alpha=0.1)
        # self.splot_pz.canvas.ax.axvline(0, color="black", alpha=0.1)
        # self.splot_pz.canvas.ax.set_xlim(left=-max*PZ_LIM_SCALING, right=max*PZ_LIM_SCALING)
        # self.splot_pz.canvas.ax.set_ylim(bottom=-max*PZ_LIM_SCALING, top=max*PZ_LIM_SCALING)

        # zeroes_f = self.splot_pz.canvas.ax.scatter(z.real, z.imag, marker='o')
        # poles_f = self.splot_pz.canvas.ax.scatter(p.real, p.imag, marker='x')

        # cursor(zeroes_f).connect("add", self.formatZeroAnnotation)
        # cursor(poles_f).connect("add", self.formatPoleAnnotation)

    def openImplementationDialog(self):
        sel_impl = self.si_type_cb.currentIndex()
        stage = self.stages_list.currentItem().data(Qt.UserRole).origin
        if(not stage): return
        if(sel_impl == CellCalculator.PASSIVERC):
            pass
        elif(sel_impl == CellCalculator.PASSIVERLC):
            pass
        elif(sel_impl == CellCalculator.SALLENKEY):
            pass
        elif(sel_impl == CellCalculator.RAUCH):
            pass
        elif(sel_impl == CellCalculator.DOUBLET):
            pass
        elif(sel_impl == CellCalculator.SEDRA):
            pass
        elif(sel_impl == CellCalculator.KHN):
            pass
        elif(sel_impl == CellCalculator.TOWTHOMAS):
            pass
        elif(sel_impl == CellCalculator.ACKERBERG):
            pass
        elif(sel_impl == CellCalculator.FLEISCHERTOW):
            self.ftd.open()
            self.ftd.populate(stage)
    
    def copyFilterHhuman(self):
        if(self.selected_dataset_data.type == 'filter'):
            clipboard = QCoreApplication.instance().clipboard()
            clipboard.setText(self.selected_dataset_data.origin.tf.buildSymbolicText())
    
    def copyFilterHlatex(self):
        if(self.selected_dataset_data.type == 'filter'):
            clipboard = QCoreApplication.instance().clipboard()
            s = self.selected_dataset_data.origin.tf.buildSymbolicText()
            clipboard.setText(self.selected_dataset_data.origin.tf.getLatex(s))

    def copyStageHhuman(self):
        if(self.stages_list.currentItem()):
            clipboard = QCoreApplication.instance().clipboard()
            tf = self.stages_list.currentItem().data(Qt.UserRole).origin
            clipboard.setText(tf.buildSymbolicText())

    def copyStageHlatex(self):
        if(self.stages_list.currentItem()):
            clipboard = QCoreApplication.instance().clipboard()
            tf = self.stages_list.currentItem().data(Qt.UserRole).origin
            s = tf.buildSymbolicText()
            clipboard.setText(tf.getLatex(s))
