import React, { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function formatAny(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return String(v)
  return String(v)
}

function VitalCard({ title, value, unit, rangeLabel, tone = 'ok', trend }) {
  return (
    <div className={`bpCard bpCard--${tone}`}>
      <div className="bpCardTop">
        <div className="bpCardTitle">{title}</div>
        <div className={`bpDot bpDot--${tone}`} />
      </div>
      <div className="bpCardMid">
        <div className="bpCardValue">{formatAny(value)}</div>
        <div className="bpCardUnit">{unit}</div>
      </div>
      <div className="bpCardBottom">
        <div className="bpCardRange">{rangeLabel}</div>
        <div className="bpSpark">
          <ResponsiveContainer width="100%" height={34}>
            <LineChart data={trend} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
              <Line type="monotone" dataKey="y" stroke="rgba(15,23,42,0.65)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function SafetyRow({ label, ok, detail }) {
  const tone = ok ? 'ok' : 'crit'
  return (
    <div className="bpSafetyRow">
      <div className="bpSafetyLeft">
        <div className="bpSafetyLabel">{label}</div>
        <div className="bpSafetyDetail">{detail}</div>
      </div>
      <div className={`bpSafetyStatus bpSafetyStatus--${tone}`}>{ok ? 'PASS' : 'FAIL'}</div>
    </div>
  )
}

export default function Dashboard() {
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const [pulse, setPulse] = useState(2)
  const [selectedProfile, setSelectedProfile] = useState('Adult')
  const [activeView, setActiveView] = useState('dashboard')
  const [whatIfValues, setWhatIfValues] = useState({
    systolic: 120,
    diastolic: 80,
    pulse: 72
  })

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setPulse(p => (p + 1) % 6), 900)
    return () => clearInterval(id)
  }, [running])

  const simulation = useMemo(() => {
    const systolic = clamp(118 + (pulse - 2) * 2 + Math.sin(tick * 0.3) * 2, 85, 185)
    const diastolic = clamp(76 + (pulse - 2) * 1 + Math.cos(tick * 0.25) * 1.5, 55, 120)
    const map = Math.round((systolic + 2 * diastolic) / 3)
    const hr = clamp(72 + (pulse - 2) * 3 + Math.sin(tick * 0.18) * 3, 45, 160)

    const statusTone = v => (v < 120 ? 'ok' : v < 140 ? 'warn' : 'crit')

    const cuffMax = 300
    const cuffPressurePeak = clamp(220 + (pulse - 2) * 12, 150, 290)
    const inflationTime = clamp(12 + (pulse - 2) * 0.7, 8, 20)
    const controlledDeflation = pulse !== 5
    const sensorError = pulse === 4

    return {
      systolic: Math.round(systolic),
      diastolic: Math.round(diastolic),
      map,
      hr: Math.round(hr),
      tones: {
        systolic: statusTone(systolic),
        diastolic: diastolic < 80 ? 'ok' : diastolic < 90 ? 'warn' : 'crit',
        map: map < 95 ? 'ok' : map < 110 ? 'warn' : 'crit',
        hr: hr < 100 ? 'ok' : hr < 120 ? 'warn' : 'crit'
      },
      safety: {
        maxCuffOk: cuffPressurePeak <= cuffMax,
        inflationTimeOk: inflationTime <= 15,
        controlledDeflationOk: controlledDeflation,
        sensorOk: !sensorError
      },
      cuff: {
        peak: cuffPressurePeak,
        inflationTime
      }
    }
  }, [tick, pulse])

  const mapValue = useMemo(() => {
    const { systolic, diastolic } = whatIfValues
    return Number(((systolic + 2 * diastolic) / 3).toFixed(1))
  }, [whatIfValues])

  const bpStatus = useMemo(() => {
    const { systolic, diastolic } = whatIfValues
    if (systolic >= 180 || diastolic >= 120) return 'CRISIS'
    if (systolic >= 140 || diastolic >= 90) return 'STAGE 2'
    if (systolic >= 130 || diastolic >= 80) return 'STAGE 1'
    if (systolic >= 120) return 'ELEVATED'
    return 'NORMAL'
  }, [whatIfValues])

  const statusColor = useMemo(() => {
    switch (bpStatus) {
      case 'CRISIS': return 'crit'
      case 'STAGE 2': return 'crit'
      case 'STAGE 1': return 'warn'
      case 'ELEVATED': return 'warn'
      default: return 'ok'
    }
  }, [bpStatus])

  const cuffPressureData = useMemo(() => {
    const points = []
    const peak = simulation.cuff.peak
    for (let i = 0; i < 140; i++) {
      const t = i / 10
      const phase = i / 140
      let y = 0
      if (phase < 0.35) {
        y = peak * (phase / 0.35)
      } else if (phase < 0.72) {
        const p = (phase - 0.35) / 0.37
        const osc = Math.sin(p * Math.PI * 10) * (10 + simulation.systolic * 0.03)
        y = peak - p * peak * 0.25 + osc
      } else {
        const p = (phase - 0.72) / 0.28
        y = peak * 0.75 * (1 - p)
      }
      points.push({ t: Number(t.toFixed(1)), y: Number(y.toFixed(1)) })
    }
    return points
  }, [simulation.cuff.peak, simulation.systolic])

  const oscillationData = useMemo(() => {
    const points = []
    const peakX = 0.55
    for (let i = 0; i < 120; i++) {
      const t = i / 10
      const x = i / 120
      const gauss = Math.exp(-Math.pow((x - peakX) / 0.16, 2))
      const y = (2 + gauss * (22 + simulation.diastolic * 0.08)) * (0.85 + Math.sin(i * 0.25) * 0.06)
      points.push({ t: Number(t.toFixed(1)), y: Number(y.toFixed(2)), x })
    }
    return { points, peakT: Number((peakX * 12).toFixed(1)) }
  }, [simulation.diastolic])

  const trend = useMemo(() => {
    const arr = []
    for (let i = 0; i < 20; i++) {
      arr.push({ x: i, y: clamp(0.6 + Math.sin((tick + i) * 0.2) * 0.25 + (pulse - 2) * 0.02, 0.2, 1.0) })
    }
    return arr
  }, [tick, pulse])

  const overallSafe = Object.values(simulation.safety).every(Boolean)

  function downloadPdf() {
    const prevTitle = document.title
    document.title = 'BP Monitoring - Dashboard'
    window.setTimeout(() => {
      window.print()
      document.title = prevTitle
    }, 50)
  }

  return (
    <div className="bpRoot">
      <div className="bpNav">
        <div className="bpNavLeft">
          <div className="bpNavBrand">
            <div className="bpNavMark">∿</div>
            <div className="bpNavTitle">GenAI Digital Twin Platform — Blood Pressure Monitoring System</div>
          </div>
          <div className="bpNavLinks bpNoPrint">
            <button type="button" className={activeView === 'dashboard' ? 'bpNavLink bpNavLink--active' : 'bpNavLink'} onClick={() => setActiveView('dashboard')}>
              Dashboard &amp; Design
            </button>
            <button type="button" className="bpNavLink" onClick={() => setActiveView('dashboard')}>
              Patient Data
            </button>
            <button type="button" className={activeView === 'whatif' ? 'bpNavLink bpNavLink--active' : 'bpNavLink'} onClick={() => setActiveView('whatif')}>
              Simulation
            </button>
            <button type="button" className="bpNavLink" onClick={() => setActiveView('dashboard')}>
              Analytics
            </button>
          </div>
        </div>

        <div className="bpNavRight bpNoPrint">
          <button className="bpIconBtn" type="button" aria-label="Settings">
            ⚙
          </button>
          <button className="bpIconBtn" type="button" aria-label="Notifications">
            🔔
          </button>
          <div className="bpUser">
            <div className="bpUserName">Dr. Aris Thorne</div>
            <div className="bpUserRole">Cardiovascular Lead</div>
          </div>
        </div>
      </div>

      <div className="bpTabs">
        <button
          className={activeView === 'dashboard' ? 'bpTab bpTab--active' : 'bpTab'}
          onClick={() => setActiveView('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={activeView === 'whatif' ? 'bpTab bpTab--active' : 'bpTab'}
          onClick={() => setActiveView('whatif')}
        >
          What‑If Analysis
        </button>
      </div>

      {activeView === 'dashboard' ? (
        <>
          <div className="bpActionRow bpNoPrint">
            <button className="bpBtn" type="button" onClick={() => setRunning(true)} disabled={running}>
              Start Measurement
            </button>
            <button className="bpBtn bpBtnGhost" type="button" onClick={() => setRunning(false)} disabled={!running}>
              Stop
            </button>
            <button className="bpBtn bpBtnGhost" type="button" onClick={downloadPdf}>
              Export PDF
            </button>
          </div>

          <div className="bpMetricStrip">
            <div className="bpMetric">
              <div className="bpMetricLabel">SYSTOLIC</div>
              <div className="bpMetricValue">
                {simulation.systolic}
                <span className="bpMetricUnit">mmHg</span>
              </div>
            </div>
            <div className="bpMetric">
              <div className="bpMetricLabel">DIASTOLIC</div>
              <div className="bpMetricValue">
                {simulation.diastolic}
                <span className="bpMetricUnit">mmHg</span>
              </div>
            </div>
            <div className="bpMetric">
              <div className="bpMetricLabel">MAP</div>
              <div className="bpMetricValue">
                {simulation.map}
                <span className="bpMetricUnit">mmHg</span>
              </div>
            </div>
            <div className="bpMetric">
              <div className="bpMetricLabel">HEART RATE</div>
              <div className="bpMetricValue">
                {simulation.hr}
                <span className="bpMetricUnit">bpm</span>
              </div>
            </div>
            <div className="bpMetric">
              <div className="bpMetricLabel">SIGNAL QUALITY</div>
              <div className="bpMetricValue">
                {clamp(92 + (running ? 4 : 0) + (pulse === 4 ? -12 : 0) + Math.sin(tick * 0.2) * 2, 65, 99).toFixed(0)}
                <span className="bpMetricUnit">%</span>
              </div>
            </div>
            <div className="bpMetric">
              <div className="bpMetricLabel">STATUS</div>
              <div className="bpMetricStatus">
                <span className={running ? 'bpStatusDot bpStatusDot--ok' : 'bpStatusDot'} />
                {running ? 'Active' : 'Idle'}
              </div>
            </div>
          </div>

          <div className="bpDashGrid">
            <div className="bpPanel">
            <div className="bpPanelHeader">
              <div className="bpPanelTitle">Cuff Pressure vs Time</div>
              <div className="bpPanelMeta">Live Feed</div>
            </div>
            <div className="bpPanelBody">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={cuffPressureData} margin={{ top: 14, right: 16, left: 44, bottom: 30 }}>
                  <CartesianGrid stroke="rgba(15,23,42,0.10)" strokeDasharray="3 6" />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 16, fontWeight: 1000, fill: 'rgba(15,23,42,0.85)' }}
                    stroke="rgba(15,23,42,0.70)"
                    tickMargin={10}
                    height={38}
                    label={{ value: 'Time (s)', position: 'insideBottom', offset: -12, fill: 'rgba(15,23,42,0.82)', fontSize: 20, fontWeight: 1000 }}
                  />
                  <YAxis
                    width={64}
                    tick={{ fontSize: 16, fontWeight: 1000, fill: 'rgba(15,23,42,0.85)' }}
                    stroke="rgba(15,23,42,0.70)"
                    tickMargin={10}
                    label={{ value: 'P(mmHg)', angle: -90, position: 'insideLeft', offset: 10, fill: 'rgba(15,23,42,0.90)', fontSize: 22, fontWeight: 1000 }}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="y" stroke="#0f766e" strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

            <div className="bpPanel">
            <div className="bpPanelHeader">
              <div className="bpPanelTitle">Oscillometric Pulse Signal</div>
              <div className="bpPanelMeta">High Res</div>
            </div>
            <div className="bpPanelBody">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={oscillationData.points.map((p, i) => ({ t: Number((i / 12).toFixed(2)), y: (Math.sin(i * 0.6) > 0.92 ? 1 : 0) * (6 + Math.sin(i * 0.2) * 2) - 2 + Math.sin(i * 0.12) * 0.6 }))}
                  margin={{ top: 14, right: 16, left: 44, bottom: 30 }}
                >
                  <CartesianGrid stroke="rgba(15,23,42,0.10)" strokeDasharray="3 6" />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 16, fontWeight: 1000, fill: 'rgba(15,23,42,0.85)' }}
                    stroke="rgba(15,23,42,0.70)"
                    tickMargin={10}
                    height={38}
                    label={{ value: 'Time (s)', position: 'insideBottom', offset: -12, fill: 'rgba(15,23,42,0.82)', fontSize: 20, fontWeight: 1000 }}
                  />
                  <YAxis
                    width={64}
                    tick={{ fontSize: 16, fontWeight: 1000, fill: 'rgba(15,23,42,0.85)' }}
                    stroke="rgba(15,23,42,0.70)"
                    tickMargin={10}
                    label={{ value: 'Pulse (a.u.)', angle: -90, position: 'insideLeft', offset: 10, fill: 'rgba(15,23,42,0.90)', fontSize: 22, fontWeight: 1000 }}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="y" stroke="#0f766e" strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

            <div className="bpPanel bpPanel--wide">
              <div className="bpPanelHeader">
                <div className="bpPanelTitle">Envelope Detection</div>
                <div className="bpPanelMeta">MAP Prediction Output</div>
              </div>
              <div className="bpPanelBody">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={oscillationData.points.map(p => ({ t: p.x, y: p.y }))} margin={{ top: 10, right: 16, left: 44, bottom: 20 }}>
                    <CartesianGrid stroke="rgba(15,23,42,0.10)" strokeDasharray="3 6" />
                    <XAxis dataKey="t" tick={{ fontSize: 12, fill: 'rgba(15,23,42,0.65)' }} stroke="rgba(15,23,42,0.50)" />
                    <YAxis hide />
                    <Tooltip />
                    <ReferenceDot x={0.10} y={oscillationData.points[10]?.y || 0} r={5} fill="#0f766e" stroke="rgba(15,23,42,0.12)" />
                    <ReferenceDot x={0.35} y={oscillationData.points[35]?.y || 0} r={5} fill="#0f766e" stroke="rgba(15,23,42,0.12)" />
                    <ReferenceDot x={0.55} y={oscillationData.points[55]?.y || 0} r={6} fill="#0f766e" stroke="rgba(15,23,42,0.12)" />
                    <ReferenceDot x={0.72} y={oscillationData.points[72]?.y || 0} r={5} fill="#0f766e" stroke="rgba(15,23,42,0.12)" />
                    <ReferenceDot x={0.90} y={oscillationData.points[90]?.y || 0} r={5} fill="#0f766e" stroke="rgba(15,23,42,0.12)" />
                    <Line type="monotone" dataKey="y" stroke="#0f766e" strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bpPanel bpPanel--report">
            <div className="bpPanelHeader">
              <div className="bpPanelTitle">Blood Pressure Monitor System Design Report</div>
              <div className="bpPanelMeta">Documentation</div>
            </div>
            <div className="bpPanelBody">
              <div className="bpReportGrid">
                <div className="bpReportBlock">
                  <div className="bpReportKicker">01 Functional Design</div>
                  <div className="bpReportText">
                    The system uses an oscillometric measurement method with automated cuff inflation, controlled deflation, and envelope analysis to estimate systolic, diastolic, and MAP.
                  </div>
                </div>
                <div className="bpReportBlock">
                  <div className="bpReportKicker">03 Software Architecture</div>
                  <div className="bpReportText">
                    A signal pipeline performs sampling, filtering, envelope detection, and validation checks with safety limits and fault handling to prevent over‑pressurization.
                  </div>
                </div>
                <div className="bpReportBlock">
                  <div className="bpReportKicker">02 Hardware Architecture</div>
                  <div className="bpReportText">
                    Pressure sensing, micro‑pump and solenoid valve control, and MCU firmware orchestrate the measurement cycle and logging for digital twin analysis.
                  </div>
                </div>
                <div className="bpReportBlock">
                  <div className="bpReportKicker">04 Digital Twin Model</div>
                  <div className="bpReportText">
                    The twin simulates cuff dynamics and arterial oscillations to evaluate algorithm behavior across patient profiles and disturbances.
                  </div>
                </div>
              </div>

              <div className="bpReportFooter">
                <div className="bpReportMeta">
                  <div className="bpReportMetaKey">Prepared by</div>
                  <div className="bpReportMetaVal">Engineering Team Alpha</div>
                </div>
                <button className="bpBtn" type="button">Export Full Documentation</button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bpGrid">
          <div className="bpPanel">
            <div className="bpPanelHeader">
              <div className="bpPanelTitle">What‑If Analysis</div>
              <div className="bpPanelMeta">Adjust vitals to see impact</div>
            </div>
            <div className="bpPanelBody">
              <div className="bpControlRow">
                <div className="bpControlLabel">Systolic (mmHg)</div>
                <input
                  type="range"
                  min="70"
                  max="200"
                  value={whatIfValues.systolic}
                  onChange={e => setWhatIfValues(v => ({ ...v, systolic: Number(e.target.value) }))}
                  className="bpSlider"
                />
                <div className="bpSliderValue">{whatIfValues.systolic}</div>
              </div>
              <div className="bpControlRow">
                <div className="bpControlLabel">Diastolic (mmHg)</div>
                <input
                  type="range"
                  min="40"
                  max="130"
                  value={whatIfValues.diastolic}
                  onChange={e => setWhatIfValues(v => ({ ...v, diastolic: Number(e.target.value) }))}
                  className="bpSlider"
                />
                <div className="bpSliderValue">{whatIfValues.diastolic}</div>
              </div>
              <div className="bpControlRow">
                <div className="bpControlLabel">Pulse (bpm)</div>
                <input
                  type="range"
                  min="40"
                  max="180"
                  value={whatIfValues.pulse}
                  onChange={e => setWhatIfValues(v => ({ ...v, pulse: Number(e.target.value) }))}
                  className="bpSlider"
                />
                <div className="bpSliderValue">{whatIfValues.pulse}</div>
              </div>
            </div>
          </div>
          <div className="bpPanel">
            <div className="bpPanelHeader">
              <div className="bpPanelTitle">Impact Summary</div>
              <div className="bpPanelMeta">Real‑time</div>
            </div>
            <div className="bpPanelBody">
              <div className="bpSafetyRow">
                <div>
                  <div className="bpSafetyLabel">MAP</div>
                  <div className="bpSafetyDetail">Target 65–100 mmHg</div>
                </div>
                <div className="bpSafetyStatus bpSafetyStatus--ok">{mapValue} mmHg</div>
              </div>
              <div className="bpSafetyRow">
                <div>
                  <div className="bpSafetyLabel">BP Classification</div>
                  <div className="bpSafetyDetail">Based on AHA/ESC guidelines</div>
                </div>
                <div className={`bpSafetyStatus bpSafetyStatus--${statusColor}`}>{bpStatus}</div>
              </div>
              <div className="bpSafetyRow">
                <div>
                  <div className="bpSafetyLabel">Pulse Status</div>
                  <div className="bpSafetyDetail">Normal 60–100 bpm</div>
                </div>
                <div className={`bpSafetyStatus bpSafetyStatus--${whatIfValues.pulse >= 60 && whatIfValues.pulse <= 100 ? 'ok' : 'warn'}`}>
                  {whatIfValues.pulse >= 60 && whatIfValues.pulse <= 100 ? 'NORMAL' : 'ABNORMAL'}
                </div>
              </div>
              <div className="bpOverall">
                <div className="bpOverallLabel">Overall Health</div>
                <div className={`bpOverallValue bpOverallValue--${statusColor}`}>
                  {statusColor === 'ok' ? 'HEALTHY' : statusColor === 'warn' ? 'CAUTION' : 'CRITICAL'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
