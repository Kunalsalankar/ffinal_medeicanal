import React, { useEffect, useMemo, useState } from 'react'
import ParameterCard from './ParameterCard.jsx'
import WaveformChart from './WaveformChart.jsx'
import AlarmPanel from './AlarmPanel.jsx'
import SimulationPanel from './SimulationPanel.jsx'
import { runVentilatorWhatIf } from '../../api.js'

function makeWaveform({ phase, amplitude, baseline, freq, points = 120 }) {
  const data = []
  for (let i = 0; i < points; i++) {
    const t = i / 10
    const x = (i / points) * Math.PI * 2 * freq + phase
    const y = baseline + amplitude * (Math.sin(x) * 0.6 + Math.sin(x * 2) * 0.25)
    data.push({ t: t.toFixed(1), y: Number(y.toFixed(2)) })
  }
  return data
}

function ScoreRing({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="vdScoreRing" style={{ '--vdScore': `${v}%` }}>
      <div className="vdScoreValue">{v}%</div>
      <div className="vdScoreLabel">Health</div>
    </div>
  )
}

function ProgressBar({ value, tone = 'blue' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className={`vdProg vdProg--${tone}`}>
      <div className="vdProgBar" style={{ width: `${v}%` }} />
    </div>
  )
}

function StatusBadge({ label, tone }) {
  return <span className={`vdBadge vdBadge--${tone}`}>{label}</span>
}

function SectionTitle({ children, right }) {
  return (
    <div className="vdReportTitleRow">
      <div className="vdReportTitle">{children}</div>
      {right ? <div className="vdReportTitleRight">{right}</div> : null}
    </div>
  )
}

export default function Dashboard() {
  const [tick, setTick] = useState(0)
  const [simPulse, setSimPulse] = useState(0)
  const [whatIf, setWhatIf] = useState({ compliance: 25, resistance: 10, leak: 0, rr_bpm: 22, sensor_noise_pct: 0 })
  const [activeView, setActiveView] = useState('dashboard')

  const [whatIfSim, setWhatIfSim] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whatIfError, setWhatIfError] = useState('')
  const [baselineOn, setBaselineOn] = useState(true)
  const [baselineSim, setBaselineSim] = useState(null)

  const [dashSim, setDashSim] = useState(null)
  const [dashError, setDashError] = useState('')

  async function fetchBaselineSimulation() {
    try {
      const r = await runVentilatorWhatIf({
        compliance: 25,
        resistance: 10,
        leak: 0,
        rr_bpm: 22,
        sensor_noise_pct: 0,
        sim_pulse: 0,
        duration_s: 6,
        fs_hz: 50
      })
      setBaselineSim(r)
    } catch {
      setBaselineSim(null)
    }
  }

  async function fetchDashboardSimulation() {
    setDashError('')
    try {
      const r = await runVentilatorWhatIf({
        compliance: 25,
        resistance: 10,
        leak: 0,
        sim_pulse: 0,
        duration_s: 6,
        fs_hz: 50
      })
      setDashSim(r)
    } catch (e) {
      setDashError(e?.message || String(e))
      setDashSim(null)
    }
  }

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 350)
    return () => clearInterval(id)
  }, [])

  const vtIbwKg = 70

  function toneRank(tone) {
    return tone === 'crit' ? 2 : tone === 'warn' ? 1 : 0
  }

  function toneToAccent(tone) {
    return tone === 'crit' ? 'danger' : tone === 'warn' ? 'warning' : tone === 'ok' ? 'success' : 'primary'
  }

  function classifyVtMlKg(vtMl, ibwKg) {
    const mlKg = vtMl / Math.max(1, ibwKg)
    if (mlKg > 10) return { tone: 'crit', mlKg }
    if (mlKg > 8) return { tone: 'warn', mlKg }
    if (mlKg >= 4) return { tone: 'ok', mlKg }
    return { tone: 'warn', mlKg }
  }

  function classifyInspiratoryPressure(pip) {
    if (pip > 30) return 'crit'
    if (pip >= 20) return 'warn'
    if (pip >= 10) return 'ok'
    return 'warn'
  }

  function classifyPeep(peep) {
    if (peep > 15) return 'crit'
    if (peep > 10) return 'warn'
    if (peep >= 5) return 'ok'
    return 'warn'
  }

  function classifyFio2(fio2Pct) {
    if (fio2Pct > 60) return 'crit'
    if (fio2Pct > 40) return 'warn'
    if (fio2Pct >= 21) return 'ok'
    return 'warn'
  }

  function classifyFlowRate(flowLpm) {
    if (flowLpm > 80) return 'crit'
    if (flowLpm > 60) return 'warn'
    if (flowLpm >= 40) return 'ok'
    return 'warn'
  }

  function classifyLeak(leakPct) {
    if (leakPct > 10) return 'crit'
    if (leakPct >= 5) return 'warn'
    return 'ok'
  }

  function classifyBattery(battPct) {
    if (battPct < 20) return 'crit'
    if (battPct < 40) return 'warn'
    return 'ok'
  }

  const predicted = useMemo(() => {
    const basePip = 26
    const baseVt = 650
    const baseVe = 9.8

    const compliancePenalty = (25 - whatIf.compliance) * 0.45
    const resistancePenalty = (whatIf.resistance - 10) * 0.25
    const leakPenalty = whatIf.leak * 0.18

    const pip = basePip + compliancePenalty + resistancePenalty + leakPenalty + simPulse
    const vt = baseVt - (25 - whatIf.compliance) * 7 - (whatIf.resistance - 10) * 2 - whatIf.leak * 3
    const ve = baseVe - (25 - whatIf.compliance) * 0.06 - (whatIf.resistance - 10) * 0.03 - whatIf.leak * 0.02

    return {
      pip: Math.max(10, Math.round(pip)),
      vt: Math.max(200, Math.round(vt)),
      ve: Math.max(1, Number(ve.toFixed(1)))
    }
  }, [whatIf, simPulse])

  const pressureData = useMemo(() => {
    const amp = 8 + (25 - whatIf.compliance) * 0.25 + (whatIf.resistance - 10) * 0.15 + simPulse * 0.2
    const base = 5 + simPulse * 0.05
    return makeWaveform({ phase: tick * 0.25, amplitude: amp, baseline: base, freq: 1.2 })
  }, [tick, whatIf, simPulse])

  const flowData = useMemo(() => {
    const amp = 40 - (whatIf.resistance - 10) * 0.6 - whatIf.leak * 0.3
    const base = 0
    return makeWaveform({ phase: tick * 0.25, amplitude: amp, baseline: base, freq: 1.2 })
  }, [tick, whatIf])

  const pvLoop = useMemo(() => {
    const points = []
    const compliance = whatIf.compliance
    const resistance = whatIf.resistance

    // Create a simple hysteresis-like PV loop:
    // - Inspiratory limb: volume increases with pressure.
    // - Expiratory limb: volume decreases with a different curve.
    const pMin = 5 + (25 - compliance) * 0.15
    const pMax = 30 + (resistance - 10) * 0.25 + (25 - compliance) * 0.25
    const vMin = 250
    const vMax = 250 + compliance * 16

    const steps = 50
    for (let i = 0; i <= steps; i++) {
      const a = i / steps
      const p = pMin + (pMax - pMin) * a
      const v = vMin + (vMax - vMin) * Math.pow(a, 0.55)
      points.push({ x: Number(p.toFixed(1)), y: Number(v.toFixed(0)) })
    }
    for (let i = steps; i >= 0; i--) {
      const a = i / steps
      const p = pMin + (pMax - pMin) * a
      const v = vMin + (vMax - vMin) * (0.86 * Math.pow(a, 1.25) + 0.14 * a)
      points.push({ x: Number(p.toFixed(1)), y: Number(v.toFixed(0)) })
    }
    return points
  }, [whatIf])

  const displayPredicted = whatIfSim?.predicted || predicted
  const displayPressureData = whatIfSim?.pressureData || pressureData
  const displayFlowData = whatIfSim?.flowData || flowData
  const displayPvLoop = whatIfSim?.pvLoop || pvLoop
  const displayVolumeData = whatIfSim?.volumeData || null

  const baselinePressureData = baselineSim?.pressureData || null
  const baselineFlowData = baselineSim?.flowData || null
  const baselineVolumeData = baselineSim?.volumeData || null

  function mergeBaseline(simData, baseData) {
    if (!simData || !baseData) return simData
    const n = Math.min(simData.length, baseData.length)
    const out = []
    for (let i = 0; i < n; i++) {
      out.push({ ...simData[i], y_base: baseData[i]?.y })
    }
    return out
  }

  const pressurePlot = baselineOn ? mergeBaseline(displayPressureData, baselinePressureData) : displayPressureData
  const flowPlot = baselineOn ? mergeBaseline(displayFlowData, baselineFlowData) : displayFlowData
  const volumePlot = baselineOn ? mergeBaseline(displayVolumeData, baselineVolumeData) : displayVolumeData

  const dashboardPressureData = dashSim?.pressureData || pressureData
  const dashboardFlowData = dashSim?.flowData || flowData

  async function fetchWhatIfSimulation() {
    setWhatIfError('')
    setWhatIfLoading(true)
    try {
      const r = await runVentilatorWhatIf({
        compliance: whatIf.compliance,
        resistance: whatIf.resistance,
        leak: whatIf.leak,
        rr_bpm: whatIf.rr_bpm,
        sensor_noise_pct: whatIf.sensor_noise_pct,
        sim_pulse: simPulse,
        duration_s: 6,
        fs_hz: 50
      })
      setWhatIfSim(r)
    } catch (e) {
      setWhatIfError(e?.message || String(e))
      setWhatIfSim(null)
    } finally {
      setWhatIfLoading(false)
    }
  }

  useEffect(() => {
    if (activeView !== 'whatif') return
    const id = setTimeout(() => {
      fetchWhatIfSimulation()
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, whatIf, simPulse])

  useEffect(() => {
    if (activeView !== 'whatif') return
    fetchBaselineSimulation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'dashboard') return
    fetchDashboardSimulation()
    const id = setInterval(() => {
      fetchDashboardSimulation()
    }, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  const settings = {
    Mode: 'AC/PC',
    'Set RR': '22 bpm',
    'Set VT': '650 mL',
    'Set PEEP': '5 cmH2O',
    FiO2: '45%'
  }

  const alarms = [
    { name: 'HIGH PIP', state: 'ok' },
    { name: 'LOW VT', state: 'ok' },
    { name: 'APNEA', state: 'ok' }
  ]

  const standards = useMemo(() => {
    const vtMl = Number(displayPredicted?.vt) || 650
    const pip = Number(displayPredicted?.pip) || 26
    const fio2 = 45
    const peep = 5
    const flow = 50
    const leak = Number.isFinite(whatIf.leak) ? whatIf.leak : 0
    const battery = 65

    const vtClass = classifyVtMlKg(vtMl, vtIbwKg)
    const pipTone = classifyInspiratoryPressure(pip)
    const peepTone = classifyPeep(peep)
    const fio2Tone = classifyFio2(fio2)
    const flowTone = classifyFlowRate(flow)
    const leakTone = classifyLeak(leak)
    const batteryTone = classifyBattery(battery)

    const alarmWorstTone = alarms.reduce((acc, a) => {
      const t = a.state === 'crit' ? 'crit' : a.state === 'warn' ? 'warn' : 'ok'
      return toneRank(t) > toneRank(acc) ? t : acc
    }, 'ok')

    const alarmStatusLabel = alarmWorstTone === 'crit' ? 'continuous' : alarmWorstTone === 'warn' ? 'intermittent' : 'none'
    const overallTone = ['ok', vtClass.tone, pipTone, peepTone, fio2Tone, flowTone, leakTone, batteryTone, alarmWorstTone].reduce(
      (acc, t) => (toneRank(t) > toneRank(acc) ? t : acc),
      'ok'
    )
    const overallLabel = overallTone === 'ok' ? 'NORMAL' : overallTone === 'warn' ? 'WARNING' : 'CRITICAL'
    const overallSub = overallTone === 'ok' ? 'All monitored metrics within limits' : 'One or more parameters outside safe limits'

    return {
      vt: { vtMl, mlKg: vtClass.mlKg, tone: vtClass.tone },
      pip: { pip, tone: pipTone },
      peep: { peep, tone: peepTone },
      fio2: { fio2, tone: fio2Tone },
      flow: { flow, tone: flowTone },
      leak: { leak, tone: leakTone },
      battery: { battery, tone: batteryTone },
      alarm: { tone: alarmWorstTone, statusLabel: alarmStatusLabel },
      overall: { tone: overallTone, label: overallLabel, sub: overallSub }
    }
  }, [alarms, displayPredicted, whatIf.leak])

  const report = useMemo(() => {
    const now = new Date()
    const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })

    const reqs = [
      {
        requirement: 'Inspiratory Pressure Tracking',
        target: '≤ ±2 cmH2O',
        measured: '±1.1 cmH2O',
        status: 'PASS',
        evidence: 'Test-PR-012'
      },
      {
        requirement: 'PEEP Stability',
        target: '±1 cmH2O',
        measured: '±0.6 cmH2O',
        status: 'PASS',
        evidence: 'Test-PR-021'
      },
      {
        requirement: 'Alarm Response Time',
        target: '≤ 500 ms',
        measured: '420 ms',
        status: 'PASS',
        evidence: 'Bench-AL-004'
      },
      {
        requirement: 'Leak Compensation',
        target: '0–20%',
        measured: '0–18%',
        status: 'UNDER REVIEW',
        evidence: 'Sim-LK-008'
      }
    ]

    const complianceCards = [
      { name: 'ISO 60601-1', coverage: 92, open: 4, status: 'Validated' },
      { name: 'ISO 14971', coverage: 88, open: 7, status: 'Under Review' },
      { name: 'ISO 62366', coverage: 85, open: 5, status: 'Under Review' },
      { name: 'IEC 60601-1-8', coverage: 79, open: 9, status: 'Critical' }
    ]

    const hazards = [
      { hazard: 'Over-pressure event', severity: 'Critical', mitigation: 'Pressure relief + software limit', residual: 'Low', status: 'Closed' },
      { hazard: 'Power failure', severity: 'High', mitigation: 'Battery + alarm + safe state', residual: 'Medium', status: 'Open' },
      { hazard: 'Sensor drift', severity: 'Medium', mitigation: 'Calibration + plausibility checks', residual: 'Low', status: 'Closed' }
    ]

    const faults = [
      { scenario: 'Flow sensor stuck-at', expected: 'Detect + degrade control', observed: 'Detected + fallback', status: 'PASS' },
      { scenario: 'Valve latency +80ms', expected: 'Maintain PIP within limit', observed: 'PIP +1.2 cmH2O', status: 'PASS' },
      { scenario: 'O2 supply drop', expected: 'Trigger alarm + hold safe FiO2', observed: 'Alarm triggered', status: 'PASS' }
    ]

    const kpis = [
      { label: 'Design Time Reduction', value: 42 },
      { label: 'Cost Reduction', value: 18 },
      { label: 'Model Accuracy', value: 92 },
      { label: 'System Latency', value: 74 },
      { label: 'Scalability Index', value: 81 }
    ]

    const architecture = {
      totalComponents: 28,
      interfacesValidated: true,
      integrationErrors: 2,
      systems: [
        {
          name: 'Gas Delivery & Blending',
          status: 'Good',
          children: [
            { name: 'Proportional Valve', status: 'Good' },
            { name: 'Flow Sensor', status: 'Warning' },
            { name: 'Mixer', status: 'Good' }
          ]
        },
        {
          name: 'Control & Safety',
          status: 'Good',
          children: [
            { name: 'Alarm Manager', status: 'Good' },
            { name: 'Watchdog', status: 'Good' },
            { name: 'Closed-loop Controller', status: 'Good' }
          ]
        }
      ]
    }

    return {
      title: 'Medical Device Design Report',
      deviceName: 'ICU Mechanical Ventilator (Digital Twin)',
      version: 'v2.4',
      date,
      score: 92,
      status: 'Validated',
      summary: {
        description:
          'Advanced ventilator system leveraging digital twin technology for real-time validation of respiratory mechanics and safety control loops.',
        class: 'Class III',
        fidelity: 'High (90%+)',
        complianceCoverage: 88,
        riskIndex: 'Low'
      },
      requirementCoverage: 94,
      reqs,
      complianceCards,
      risk: {
        hazardsTotal: 23,
        highRisk: 3,
        residualSummary: 'Residual risks reduced to acceptable levels for current prototype phase.',
        riskScore: 18,
        hazards
      },
      fault: {
        coverage: 86,
        rows: faults
      },
      kpis,
      architecture
    }
  }, [])

  const complianceTracker = useMemo(
    () => ({
      title: 'Regulatory Compliance Tracker',
      subtitle: 'Real-time digital twin verification of ISO 80601-2-12 and supplemental device standards.',
      rows: [
        {
          standard: 'ISO 80601-2-12',
          parameter: 'Inspiratory Pressure',
          constraint: '< 60 cmH2O',
          simulated: '42 cmH2O',
          status: 'PASS'
        },
        {
          standard: 'ISO 80601-2-12',
          parameter: 'Expiratory Resistance',
          constraint: '< 6 cmH2O',
          simulated: '5.1 cmH2O',
          status: 'PASS'
        },
        {
          standard: 'ISO 13485:2016',
          parameter: 'Risk Management Analysis',
          constraint: 'Required Documentation',
          simulated: 'Missing File Path',
          status: 'FAIL'
        },
        {
          standard: 'IEC 60601-1',
          parameter: 'Leakage Current',
          constraint: '< 500 µA',
          simulated: '120 µA',
          status: 'PASS'
        },
        {
          standard: 'ISO 80601-2-12',
          parameter: 'O2 Concentration Accuracy',
          constraint: '± 3% volume',
          simulated: '+ 4.2% volume',
          status: 'FAIL'
        },
        {
          standard: 'ISO 14971:2019',
          parameter: 'FMEA Matrix',
          constraint: 'Risk Score < 12',
          simulated: '8.5 Average',
          status: 'PASS'
        }
      ]
    }),
    []
  )

  const bom = useMemo(
    () => ({
      title: 'Bill of Materials',
      subtitle:
        'AI-optimized component selection for medical device engineering, regulatory compliance (ISO 13485), and long-term reliability.',
      totals: {
        totalComponents: 42,
        systemMtbf: '1.2M hrs',
        estimatedCost: '₹4,150',
        complianceScore: 92
      },
      rows: [
        {
          partId: 'P-101',
          component: 'High-Flow Solenoid',
          category: 'Pneumatic',
          model: 'Bürkert 6013',
          mtbf: '850k hrs',
          status: 'Compliant'
        },
        {
          partId: 'E-284',
          component: 'Micro-Controller',
          category: 'Electronic',
          model: 'STM32H7',
          mtbf: '1.5M hrs',
          status: 'Compliant'
        },
        {
          partId: 'P-105',
          component: 'Pressure Regulator',
          category: 'Pneumatic',
          model: 'SMC IR2000',
          mtbf: '920k hrs',
          status: 'Compliant'
        },
        {
          partId: 'E-112',
          component: 'NTC Thermistor',
          category: 'Electronic',
          model: 'Vishay NTCL',
          mtbf: '2.0M hrs',
          status: 'Compliant'
        },
        {
          partId: 'S-502',
          component: 'Pressure Sensor',
          category: 'Mechanical',
          model: 'Honeywell ABP',
          mtbf: '620k hrs',
          status: 'Compliant'
        },
        {
          partId: 'M-888',
          component: 'Stepper Motor',
          category: 'Mechanical',
          model: 'NEMA 17',
          mtbf: '45k hrs',
          status: 'Compliant'
        }
      ]
    }),
    []
  )

  function runSimulation() {
    setSimPulse(3)
    window.setTimeout(() => setSimPulse(0), 1200)
  }

  function downloadPdf() {
    const prevTitle = document.title
    const suffix =
      activeView === 'dashboard'
        ? 'Dashboard'
        : activeView === 'whatif'
          ? 'What-If Analysis'
          : activeView === 'report'
            ? 'Medical Device Design Report'
            : activeView === 'compliance'
              ? 'Compliance Tracker'
              : 'Bill of Materials'
    document.title = `Ventilator - ${suffix}`
    window.setTimeout(() => {
      window.print()
      document.title = prevTitle
    }, 50)
  }

  return (
    <div className="vdRoot">
      <div className="vdHeader">
        <div className="vdHeaderTitle">ICU Ventilator — Digital Twin Dashboard</div>
      </div>

      <div className="vdTabs">
        <button
          type="button"
          className={`vdTab ${activeView === 'dashboard' ? 'vdTab--active' : ''}`}
          onClick={() => setActiveView('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`vdTab ${activeView === 'whatif' ? 'vdTab--active' : ''}`}
          onClick={() => setActiveView('whatif')}
        >
          What-If Analysis
        </button>
        <button
          type="button"
          className={`vdTab ${activeView === 'report' ? 'vdTab--active' : ''}`}
          onClick={() => setActiveView('report')}
        >
          Medical Device Design Report
        </button>
        <button
          type="button"
          className={`vdTab ${activeView === 'compliance' ? 'vdTab--active' : ''}`}
          onClick={() => setActiveView('compliance')}
        >
          Compliance
        </button>
        <button
          type="button"
          className={`vdTab ${activeView === 'bom' ? 'vdTab--active' : ''}`}
          onClick={() => setActiveView('bom')}
        >
          BOM
        </button>
      </div>

      <div className="vdActions vdNoPrint">
        <button type="button" className="vdPdfBtn" onClick={downloadPdf}>
          Download PDF
        </button>
      </div>

      {activeView === 'dashboard' ? (
        <>
          <div className="vdTopGrid">
            <ParameterCard label="MODE" value="AC/PC" unit="" accent="primary" />
            <ParameterCard
              label="Vt"
              value={String(Math.round(standards.vt.vtMl))}
              unit="mL"
              accent={toneToAccent(standards.vt.tone)}
              subLabel={`${standards.vt.mlKg.toFixed(1)} ml/kg`}
            />
            <ParameterCard label="RR" value="22" unit="bpm" accent="primary" />
            <ParameterCard label="PIP" value={String(Math.round(standards.pip.pip))} unit="cmH2O" accent={toneToAccent(standards.pip.tone)} />
            <ParameterCard label="Ve" value={String(displayPredicted.ve)} unit="L/min" accent="primary" />
            <ParameterCard label="PEEP" value={String(standards.peep.peep)} unit="cmH2O" accent={toneToAccent(standards.peep.tone)} />
            <ParameterCard label="FiO2" value={String(standards.fio2.fio2)} unit="%" accent={toneToAccent(standards.fio2.tone)} />
            <ParameterCard label="System" value={standards.overall.label} unit="" accent={toneToAccent(standards.overall.tone)} subLabel="System Status" />
          </div>

          <div className="vdMainGrid">
            <div className="vdCharts">
              <div className="vdChartsRow">
                <WaveformChart
                  title="AIRWAY PRESSURE vs TIME"
                  data={dashboardPressureData}
                  yLabel="Pressure (cmH2O)"
                  lineColor="#0EA5E9"
                />
                <WaveformChart
                  title="AIR FLOW RATE vs TIME"
                  data={dashboardFlowData}
                  yLabel="Flow (L/min)"
                  lineColor="#8B5CF6"
                />
              </div>
            </div>

            <AlarmPanel
              settings={settings}
              alarms={alarms}
              systemTone={standards.overall.tone}
              systemLabel={standards.overall.label}
              systemSub={standards.overall.sub}
              alarmStatusLabel={standards.alarm.statusLabel}
            />
          </div>
          {dashError ? <div className="vdSideHint">{dashError}</div> : null}
        </>
      ) : null}

      {activeView === 'whatif' ? (
        <>
          <div className="vdWhatIfLayout">
            <div>
              <SimulationPanel
                state={whatIf}
                setState={setWhatIf}
                predicted={displayPredicted}
                onRun={fetchWhatIfSimulation}
              />
              <div className="vdSideSection">
                <div className="vdSideTitle">SciPy Simulation</div>
                <div className="vdKVKey">Status</div>
                <div className="vdKVVal">{whatIfLoading ? 'RUNNING' : whatIfError ? 'ERROR' : 'READY'}</div>
                {whatIfError ? <div className="vdSideHint">{whatIfError}</div> : null}
              </div>
            </div>

            <div className="vdCharts">
              <div className="vdChartToolbar">
                <div className="vdToggleRow">
                  <div className="vdToggleLabel">Show Baseline Comparison</div>
                  <button
                    type="button"
                    className={baselineOn ? 'vdToggle vdToggle--on' : 'vdToggle'}
                    onClick={() => setBaselineOn(v => !v)}
                  >
                    <span className="vdToggleThumb" />
                  </button>
                </div>
              </div>
              <div className="vdChartsCol">
                <div className="vdPredTitle">Predicted Outputs</div>
                <div className="vdPredGrid vdPredGrid--row">
                  <div className="vdPredItem">
                    <div className="vdPredLabel">PREDICTED PIP</div>
                    <div className="vdPredValue">
                      {displayPredicted.pip} <span className="vdPredUnit">cmH2O</span>
                    </div>
                  </div>
                  <div className="vdPredItem">
                    <div className="vdPredLabel">PREDICTED VT</div>
                    <div className="vdPredValue">
                      {displayPredicted.vt} <span className="vdPredUnit">mL</span>
                    </div>
                  </div>
                  <div className="vdPredItem">
                    <div className="vdPredLabel">PREDICTED Ve</div>
                    <div className="vdPredValue">
                      {displayPredicted.ve} <span className="vdPredUnit">L/min</span>
                    </div>
                  </div>
                </div>

                <WaveformChart
                  title="AIRWAY PRESSURE vs TIME"
                  data={pressurePlot}
                  yLabel="Pressure (cmH2O)"
                  lineColor="#0EA5E9"
                  baselineDataKey={baselineOn ? 'y_base' : null}
                />
                <WaveformChart
                  title="AIR FLOW RATE vs TIME"
                  data={flowPlot}
                  yLabel="Flow (L/min)"
                  lineColor="#8B5CF6"
                  baselineDataKey={baselineOn ? 'y_base' : null}
                />
                {volumePlot ? (
                  <WaveformChart
                    title="VOLUME vs TIME"
                    data={volumePlot}
                    yLabel="Volume (mL)"
                    lineColor="#F59E0B"
                    baselineDataKey={baselineOn ? 'y_base' : null}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {activeView === 'report' ? (
        <div className="vdReport">
          <div className="vdReportHeader">
            <div className="vdReportHeaderLeft">
              <div className="vdReportH1">{report.title}</div>
              <div className="vdReportMeta">
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Device</span>
                  <span className="vdReportMetaVal">{report.deviceName}</span>
                </div>
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Version</span>
                  <span className="vdReportMetaVal">{report.version}</span>
                </div>
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Date</span>
                  <span className="vdReportMetaVal">{report.date}</span>
                </div>
              </div>
            </div>

            <div className="vdReportHeaderRight">
              <ScoreRing value={report.score} />
              <div className="vdReportStatus">
                <div className="vdReportStatusLabel">Status</div>
                <StatusBadge label={report.status} tone={report.status === 'Validated' ? 'ok' : 'warn'} />
                <div className="vdReportStatusSub">Overall Health Score</div>
              </div>
            </div>
          </div>

          <div className="vdReportGrid">
            <div className="vdReportCard">
              <SectionTitle>Executive Summary</SectionTitle>
              <div className="vdReportText">{report.summary.description}</div>
              <div className="vdReportKVs">
                <div className="vdReportKV">
                  <div className="vdReportKVKey">Device Classification</div>
                  <div className="vdReportKVVal">{report.summary.class}</div>
                </div>
                <div className="vdReportKV">
                  <div className="vdReportKVKey">Simulation Fidelity</div>
                  <div className="vdReportKVVal">{report.summary.fidelity}</div>
                </div>
                <div className="vdReportKV">
                  <div className="vdReportKVKey">Compliance Coverage</div>
                  <div className="vdReportKVVal">{report.summary.complianceCoverage}%</div>
                </div>
                <div className="vdReportKV">
                  <div className="vdReportKVKey">Risk Index</div>
                  <div className="vdReportKVVal">{report.summary.riskIndex}</div>
                </div>
              </div>
            </div>

          <div className="vdReportCard">
            <SectionTitle
              right={
                <div className="vdInlineRight">
                  <div className="vdInlineKey">Requirement Coverage</div>
                  <div className="vdInlineVal">{report.requirementCoverage}%</div>
                </div>
              }
            >
              Functional Requirements Status
            </SectionTitle>
            <ProgressBar value={report.requirementCoverage} tone="blue" />
            <div className="vdTableWrap">
              <table className="vdTable">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Target</th>
                    <th>Measured</th>
                    <th>Status</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.reqs.map(r => (
                    <tr key={r.requirement}>
                      <td className="vdTdStrong">{r.requirement}</td>
                      <td>{r.target}</td>
                      <td>{r.measured}</td>
                      <td>
                        <StatusBadge
                          label={r.status}
                          tone={r.status === 'PASS' ? 'ok' : r.status === 'UNDER REVIEW' ? 'warn' : 'crit'}
                        />
                      </td>
                      <td>
                        <span className="vdLink">{r.evidence}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle>Compliance Status</SectionTitle>
            <div className="vdComplianceGrid">
              {report.complianceCards.map(c => (
                <div key={c.name} className="vdComplianceCard">
                  <div className="vdComplianceTop">
                    <div className="vdComplianceName">{c.name}</div>
                    <StatusBadge
                      label={c.status}
                      tone={c.status === 'Validated' ? 'ok' : c.status === 'Under Review' ? 'warn' : 'crit'}
                    />
                  </div>
                  <div className="vdComplianceMid">
                    <div className="vdCompliancePct">{c.coverage}%</div>
                    <div className="vdComplianceSub">Coverage</div>
                  </div>
                  <ProgressBar value={c.coverage} tone={c.status === 'Critical' ? 'red' : c.status === 'Validated' ? 'green' : 'amber'} />
                  <div className="vdComplianceBottom">
                    <div className="vdComplianceMini">
                      <div className="vdComplianceMiniKey">Open Clauses</div>
                      <div className="vdComplianceMiniVal">{c.open}</div>
                    </div>
                    <div className="vdComplianceMini">
                      <div className="vdComplianceMiniKey">Traceability</div>
                      <div className="vdComplianceMiniVal vdLink">Expand</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle
              right={
                <div className="vdInlineRight">
                  <div className="vdInlineKey">Risk Score</div>
                  <div className="vdInlineVal">{report.risk.riskScore}/100</div>
                </div>
              }
            >
              Risk Management Summary
            </SectionTitle>

            <div className="vdRiskTop">
              <div className="vdRiskStat">
                <div className="vdRiskKey">Total Hazards</div>
                <div className="vdRiskVal">{report.risk.hazardsTotal}</div>
              </div>
              <div className="vdRiskStat">
                <div className="vdRiskKey">High-Risk</div>
                <div className="vdRiskVal vdRiskValWarn">{report.risk.highRisk}</div>
              </div>
              <div className="vdRiskStat">
                <div className="vdRiskKey">Residual Risk</div>
                <div className="vdRiskVal">Acceptable</div>
              </div>
            </div>

            <div className="vdReportText">{report.risk.residualSummary}</div>
            <ProgressBar value={100 - report.risk.riskScore} tone="green" />

            <div className="vdTableWrap">
              <table className="vdTable">
                <thead>
                  <tr>
                    <th>Hazard</th>
                    <th>Severity</th>
                    <th>Mitigation</th>
                    <th>Residual</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.risk.hazards.map(h => (
                    <tr key={h.hazard}>
                      <td className="vdTdStrong">{h.hazard}</td>
                      <td>
                        <StatusBadge label={h.severity} tone={h.severity === 'Critical' ? 'crit' : h.severity === 'High' ? 'warn' : 'ok'} />
                      </td>
                      <td>{h.mitigation}</td>
                      <td>{h.residual}</td>
                      <td>
                        <StatusBadge label={h.status} tone={h.status === 'Closed' ? 'ok' : 'warn'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle
              right={
                <div className="vdInlineRight">
                  <div className="vdInlineKey">Scenario Coverage</div>
                  <div className="vdInlineVal">{report.fault.coverage}%</div>
                </div>
              }
            >
              Fault Injection Summary
            </SectionTitle>
            <ProgressBar value={report.fault.coverage} tone="blue" />
            <div className="vdTableWrap">
              <table className="vdTable">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Expected</th>
                    <th>Observed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fault.rows.map(f => (
                    <tr key={f.scenario}>
                      <td className="vdTdStrong">{f.scenario}</td>
                      <td>{f.expected}</td>
                      <td>{f.observed}</td>
                      <td>
                        <StatusBadge label={f.status} tone={f.status === 'PASS' ? 'ok' : 'warn'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle>Performance KPIs</SectionTitle>
            <div className="vdKpiGrid">
              {report.kpis.map(k => (
                <div key={k.label} className="vdKpiCard">
                  <div className="vdKpiTop">
                    <div className="vdKpiLabel">{k.label}</div>
                    <div className="vdKpiValue">{k.value}%</div>
                  </div>
                  <ProgressBar value={k.value} tone="blue" />
                </div>
              ))}
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle>Architecture Health</SectionTitle>
            <div className="vdArchTop">
              <div className="vdArchStat">
                <div className="vdArchKey">Total Components</div>
                <div className="vdArchVal">{report.architecture.totalComponents}</div>
              </div>
              <div className="vdArchStat">
                <div className="vdArchKey">Interface Validation</div>
                <div className="vdArchVal">
                  <StatusBadge label={report.architecture.interfacesValidated ? 'Validated' : 'Open'} tone={report.architecture.interfacesValidated ? 'ok' : 'warn'} />
                </div>
              </div>
              <div className="vdArchStat">
                <div className="vdArchKey">Integration Errors</div>
                <div className="vdArchVal vdRiskValWarn">{report.architecture.integrationErrors}</div>
              </div>
            </div>

            <div className="vdArchTree">
              {report.architecture.systems.map(sys => (
                <div key={sys.name} className="vdArchNode">
                  <div className="vdArchNodeTop">
                    <div className="vdArchNodeName">{sys.name}</div>
                    <StatusBadge label={sys.status} tone={sys.status === 'Good' ? 'ok' : 'warn'} />
                  </div>
                  <div className="vdArchChildren">
                    {sys.children.map(ch => (
                      <div key={ch.name} className="vdArchChild">
                        <div className="vdArchChildName">{ch.name}</div>
                        <StatusBadge label={ch.status} tone={ch.status === 'Good' ? 'ok' : 'warn'} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="vdReportCard">
            <SectionTitle>Design Report Download</SectionTitle>
            <div className="vdDlGrid">
              <button className="vdDlBtn" type="button">Download Full PDF Report</button>
              <button className="vdDlBtn vdDlBtnGhost" type="button">Export JSON Architecture</button>
              <button className="vdDlBtn vdDlBtnGhost" type="button">Export Compliance Mapping</button>
              <button className="vdDlBtn vdDlBtnGhost" type="button">Export Risk Log</button>
            </div>
            <div className="vdDlHint">Exports are demo placeholders for PPT. Connect these to your backend later if needed.</div>
          </div>
          </div>
        </div>
      ) : null}

      {activeView === 'compliance' ? (
        <div className="vdReport">
          <div className="vdReportHeader">
            <div className="vdReportHeaderLeft">
              <div className="vdReportH1">{complianceTracker.title}</div>
              <div className="vdReportText">{complianceTracker.subtitle}</div>
            </div>
            <div className="vdReportHeaderRight">
              <div className="vdReportStatus">
                <div className="vdReportStatusLabel">Run</div>
                <StatusBadge label="Simulation" tone="ok" />
                <div className="vdReportStatusSub">Latest verification snapshot</div>
              </div>
            </div>
          </div>

          <div className="vdReportGrid">
            <div className="vdReportCard">
              <SectionTitle>ISO Standards</SectionTitle>
              <div className="vdTableWrap">
                <table className="vdTable">
                  <thead>
                    <tr>
                      <th>Regulatory Standard</th>
                      <th>Parameter</th>
                      <th>Constraint</th>
                      <th>Simulated Result</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complianceTracker.rows.map((r, idx) => (
                      <tr key={`${r.standard}-${r.parameter}-${idx}`}>
                        <td className="vdTdStrong">{r.standard}</td>
                        <td>{r.parameter}</td>
                        <td>{r.constraint}</td>
                        <td>{r.simulated}</td>
                        <td>
                          <StatusBadge label={r.status} tone={r.status === 'PASS' ? 'ok' : 'crit'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === 'bom' ? (
        <div className="vdReport">
          <div className="vdReportHeader">
            <div className="vdReportHeaderLeft">
              <div className="vdReportH1">{bom.title}</div>
              <div className="vdReportText">{bom.subtitle}</div>
              <div className="vdReportMeta">
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Total Components</span>
                  <span className="vdReportMetaVal">{bom.totals.totalComponents}</span>
                </div>
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">System MTBF</span>
                  <span className="vdReportMetaVal">{bom.totals.systemMtbf}</span>
                </div>
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Estimated BOM Cost</span>
                  <span className="vdReportMetaVal">{bom.totals.estimatedCost}</span>
                </div>
                <div className="vdReportMetaItem">
                  <span className="vdReportMetaKey">Compliance Score</span>
                  <span className="vdReportMetaVal">{bom.totals.complianceScore}%</span>
                </div>
              </div>
            </div>
            <div className="vdReportHeaderRight">
              <ScoreRing value={bom.totals.complianceScore} />
              <div className="vdReportStatus">
                <div className="vdReportStatusLabel">Status</div>
                <StatusBadge label="Compliant" tone="ok" />
                <div className="vdReportStatusSub">BOM health snapshot</div>
              </div>
            </div>
          </div>

          <div className="vdReportGrid">
            <div className="vdReportCard">
              <SectionTitle>Component List</SectionTitle>
              <div className="vdTableWrap">
                <table className="vdTable">
                  <thead>
                    <tr>
                      <th>Part ID</th>
                      <th>Component Name</th>
                      <th>Category</th>
                      <th>Selected COTS Model</th>
                      <th>Est. MTBF</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom.rows.map(r => (
                      <tr key={r.partId}>
                        <td className="vdTdStrong">{r.partId}</td>
                        <td>{r.component}</td>
                        <td>
                          <StatusBadge
                            label={r.category}
                            tone={r.category === 'Pneumatic' ? 'ok' : r.category === 'Electronic' ? 'warn' : 'crit'}
                          />
                        </td>
                        <td>{r.model}</td>
                        <td>{r.mtbf}</td>
                        <td>
                          <StatusBadge
                            label={r.status}
                            tone={r.status === 'Compliant' ? 'ok' : r.status === 'Review' ? 'warn' : 'crit'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
