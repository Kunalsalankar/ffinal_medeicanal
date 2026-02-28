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

export default function WaveformChart({ title, data, yLabel, lineColor = '#22d3ee' }) {
  return (
    <div className="vdPanel">
      <div className="vdPanelHeader">
        <div className="vdPanelTitle">{title}</div>
        <div className="vdPanelMeta">{yLabel}</div>
      </div>
      <div className="vdPanelBody">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 10, right: 18, left: 6, bottom: 22 }}>
            <CartesianGrid stroke="rgba(15, 23, 42, 0.10)" strokeDasharray="3 6" />
            <XAxis
              dataKey="t"
              stroke="rgba(15, 23, 42, 0.70)"
              tick={{ fontSize: 12 }}
              height={34}
              tickMargin={10}
              label={{
                value: 'Time (s)',
                position: 'insideBottom',
                offset: -8,
                fill: 'rgba(15,23,42,0.65)',
                fontSize: 12
              }}
            />
            <YAxis
              stroke="rgba(15, 23, 42, 0.70)"
              tick={{ fontSize: 12 }}
              label={{
                value: yLabel,
                angle: -90,
                position: 'insideLeft',
                fill: 'rgba(15,23,42,0.65)',
                fontSize: 12
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(255, 255, 255, 0.98)',
                border: '1px solid rgba(2, 132, 199, 0.22)',
                borderRadius: 12,
                color: 'rgba(15, 23, 42, 0.92)'
              }}
              labelStyle={{ color: 'rgba(15, 23, 42, 0.70)' }}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke={lineColor}
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
