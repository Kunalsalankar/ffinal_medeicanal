import React from 'react'

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
    <div className="vdWhatIf">
      <div className="vdWhatIfHeader">
        WHAT‑IF ANALYSIS SIMULATION (Virtual Patient Twin)
      </div>

      <div className="vdWhatIfGrid">
        <div className="vdWhatIfLeft">
          <Slider
            label="Lung Compliance"
            min={15}
            max={25}
            step={1}
            value={state.compliance}
            onChange={v => setState(s => ({ ...s, compliance: v }))}
            unit="mL/cmH2O"
          />
          <Slider
            label="Airway Resistance"
            min={10}
            max={25}
            step={1}
            value={state.resistance}
            onChange={v => setState(s => ({ ...s, resistance: v }))}
            unit="cmH2O/L/s"
          />
          <Slider
            label="Leak Percentage"
            min={0}
            max={15}
            step={1}
            value={state.leak}
            onChange={v => setState(s => ({ ...s, leak: v }))}
            unit="%"
          />
        </div>

        <div className="vdWhatIfRight">
          <div className="vdPredTitle">Predicted Outputs</div>

          <div className="vdPredGrid">
            <div className="vdPredItem">
              <div className="vdPredLabel">PREDICTED PIP</div>
              <div className="vdPredValue">
                {predicted.pip} <span className="vdPredUnit">cmH2O</span>
              </div>
            </div>
            <div className="vdPredItem">
              <div className="vdPredLabel">PREDICTED VT</div>
              <div className="vdPredValue">
                {predicted.vt} <span className="vdPredUnit">mL</span>
              </div>
            </div>
            <div className="vdPredItem">
              <div className="vdPredLabel">PREDICTED Ve</div>
              <div className="vdPredValue">
                {predicted.ve} <span className="vdPredUnit">L/min</span>
              </div>
            </div>
          </div>

          <button className="vdSimBtn" onClick={onRun}>
            RUN SIMULATION
          </button>

          <div className="vdSimHint">
            Outputs update with sliders; simulation adds a small animated change to waveforms.
          </div>
        </div>
      </div>
    </div>
  )
}
