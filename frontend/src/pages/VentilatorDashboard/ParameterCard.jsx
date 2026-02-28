import React from 'react'

export default function ParameterCard({ label, value, unit, accent = 'primary', subLabel }) {
  return (
    <div className={`vdCard vdCard--${accent}`}>
      <div className="vdCardLabelRow">
        <div className="vdCardLabel">{label}</div>
        {subLabel ? <div className="vdCardSub">{subLabel}</div> : null}
      </div>
      <div className="vdCardValueRow">
        <div className="vdCardValue">{value}</div>
        {unit ? <div className="vdCardUnit">{unit}</div> : null}
      </div>
    </div>
  )
}
