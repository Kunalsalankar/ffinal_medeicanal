import React, { useEffect, useMemo, useState } from 'react'
import ParameterCard from './ParameterCard.jsx'
import WaveformChart from './WaveformChart.jsx'
import AlarmPanel from './AlarmPanel.jsx'
import SimulationPanel from './SimulationPanel.jsx'
import PvLoopChart from './PvLoopChart.jsx'

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

export default function Dashboard() {
  const [tick, setTick] = useState(0)
  const [simPulse, setSimPulse] = useState(0)
  const [whatIf, setWhatIf] = useState({ compliance: 25, resistance: 10, leak: 0 })

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 350)
    return () => clearInterval(id)
  }, [])

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

  function runSimulation() {
    setSimPulse(3)
    window.setTimeout(() => setSimPulse(0), 1200)
  }

  return (
    <div className="vdRoot">
      <div className="vdHeader">
        <div className="vdHeaderTitle">ICU Ventilator — Digital Twin Dashboard</div>
      </div>

      <div className="vdTopGrid">
        <ParameterCard label="MODE" value="AC/PC" unit="" accent="primary" />
        <ParameterCard label="Vt" value="650" unit="mL" accent="primary" />
        <ParameterCard label="RR" value="22" unit="bpm" accent="primary" />
        <ParameterCard label="PIP" value="26" unit="cmH2O" accent="warning" />
        <ParameterCard label="Ve" value="9.8" unit="L/min" accent="primary" />
        <ParameterCard label="PEEP" value="5" unit="cmH2O" accent="primary" />
        <ParameterCard label="FiO2" value="45" unit="%" accent="primary" />
        <ParameterCard label="System" value="NORMAL" unit="" accent="success" subLabel="System Status" />
      </div>

      <div className="vdMainGrid">
        <div className="vdCharts">
          <div className="vdChartsRow">
            <WaveformChart
              title="AIRWAY PRESSURE vs TIME"
              data={pressureData}
              yLabel="Pressure (cmH2O)"
              lineColor="#22d3ee"
            />
            <WaveformChart
              title="AIR FLOW RATE vs TIME"
              data={flowData}
              yLabel="Flow (L/min)"
              lineColor="#a78bfa"
            />
          </div>

          <div className="vdPvLoop">
            <PvLoopChart data={pvLoop} />
          </div>
        </div>

        <AlarmPanel settings={settings} alarms={alarms} />
      </div>

      <SimulationPanel state={whatIf} setState={setWhatIf} predicted={predicted} onRun={runSimulation} />
    </div>
  )
}
