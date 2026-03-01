import React from 'react'

function Section({ title, children }) {
  return (
    <div className="vdWhatIfSection">
      <div className="vdWhatIfSectionTitle">{title}</div>
      {children}
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange, unit }) {
  return (
    <div className="vdSlider">
      <div className="vdSliderHeader">
        <div className="vdSliderLabel">{label}</div>
        <div className="vdSliderValue">
          {value} {unit}
        </div>
      </div>
      <input
        className="vdRange"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="vdSliderScale">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  )
}

export default function SimulationPanel({ state, setState, predicted, onRun }) {
  return (
    <div className="vdWhatIf vdWhatIf--sidebar">
      <div className="vdWhatIfHeader">Ventilator What‑If Simulation</div>

      <div className="vdWhatIfGrid">
        <div className="vdWhatIfLeft">
          <Section title="Physiology">
            <Slider
              label="Lung Compliance"
              min={15}
              max={60}
              step={1}
              value={state.compliance}
              onChange={v => setState(s => ({ ...s, compliance: v }))}
              unit="mL/cmH2O"
            />
            <Slider
              label="Resistance"
              min={5}
              max={25}
              step={1}
              value={state.resistance}
              onChange={v => setState(s => ({ ...s, resistance: v }))}
              unit="cmH2O/L/s"
            />
            <Slider
              label="Resp Rate"
              min={8}
              max={35}
              step={1}
              value={state.rr_bpm}
              onChange={v => setState(s => ({ ...s, rr_bpm: v }))}
              unit="bpm"
            />
          </Section>

          <Section title="Disturbance">
            <Slider
              label="Sensor Noise"
              min={0}
              max={6}
              step={0.5}
              value={state.sensor_noise_pct}
              onChange={v => setState(s => ({ ...s, sensor_noise_pct: v }))}
              unit="%"
            />
            <Slider
              label="Circuit Leak"
              min={0}
              max={15}
              step={1}
              value={state.leak}
              onChange={v => setState(s => ({ ...s, leak: v }))}
              unit="%"
            />
          </Section>

          <Section title="Simulation Settings">
            <button className="vdSimBtn" onClick={onRun}>
              RUN SIMULATION
            </button>
            <div className="vdSimHint">Auto-updates when sliders change.</div>
          </Section>
        </div>
      </div>
    </div>
  )
}
