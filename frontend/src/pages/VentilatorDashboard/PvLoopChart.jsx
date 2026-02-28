import React from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

export default function PvLoopChart({ title = 'PRESSURE–VOLUME LOOP', data }) {
  return (
    <div className="vdPanel">
      <div className="vdPanelHeader">
        <div className="vdPanelTitle">{title}</div>
        <div className="vdPanelMeta">PV</div>
      </div>
      <div className="vdPanelBody">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 10, right: 18, left: 6, bottom: 26 }}>
            <CartesianGrid stroke="rgba(15, 23, 42, 0.10)" strokeDasharray="3 6" />
            <XAxis
              type="number"
              dataKey="x"
              domain={['dataMin', 'dataMax']}
              stroke="rgba(15, 23, 42, 0.70)"
              tick={{ fontSize: 12 }}
              height={36}
              tickMargin={10}
              label={{
                value: 'Pressure (cmH2O)',
                position: 'insideBottom',
                offset: -10,
                fill: 'rgba(15,23,42,0.65)',
                fontSize: 12
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={['dataMin', 'dataMax']}
              stroke="rgba(15, 23, 42, 0.70)"
              tick={{ fontSize: 12 }}
              label={{ value: 'Volume (mL)', angle: -90, position: 'insideLeft', fill: 'rgba(15,23,42,0.65)', fontSize: 12 }}
            />
            <Tooltip
              formatter={(v, name) => [v, name === 'x' ? 'Pressure' : 'Volume']}
              contentStyle={{
                background: 'rgba(255, 255, 255, 0.98)',
                border: '1px solid rgba(2, 132, 199, 0.22)',
                borderRadius: 12,
                color: 'rgba(15, 23, 42, 0.92)'
              }}
              labelFormatter={() => ''}
            />
            <Line type="monotone" dataKey="y" stroke="#16a34a" strokeWidth={3} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
