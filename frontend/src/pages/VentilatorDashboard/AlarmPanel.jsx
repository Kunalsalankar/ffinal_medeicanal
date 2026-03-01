import React from 'react'

function AlarmItem({ name, state }) {
  const cls = state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'crit'
  const label = state === 'ok' ? 'OK' : state === 'warn' ? 'WARN' : 'CRIT'
  return (
    <div className={`vdAlarmItem vdAlarmItem--${cls}`}>
      <div className="vdAlarmName">{name}</div>
      <div className={`vdPill vdPill--${cls}`}>{label}</div>
    </div>
  )
}

export default function AlarmPanel({ settings, alarms, systemTone = 'ok', systemLabel = 'NORMAL', systemSub = 'All monitored metrics within limits', alarmStatusLabel = null }) {
  return (
    <div className="vdSide">
      <div className="vdSideSection">
        <div className="vdSideTitle">Current Settings</div>
        <div className="vdKeyValueGrid">
          {Object.entries(settings).map(([k, v]) => (
            <div key={k} className="vdKV">
              <div className="vdKVKey">{k}</div>
              <div className="vdKVVal">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="vdSideSection">
        <div className="vdSideTitle">Alarm Status</div>
        {alarmStatusLabel ? <div className="vdCardSub">{alarmStatusLabel}</div> : null}
        <div className="vdAlarmList">
          {alarms.map(a => (
            <AlarmItem key={a.name} name={a.name} state={a.state} />
          ))}
        </div>
      </div>

      <div className="vdSideSection">
        <div className="vdSideTitle">System Status</div>
        <div className={`vdStatusBox vdStatusBox--${systemTone}`}>
          <div className="vdStatusRow">
            <div className="vdStatusBig">{systemLabel}</div>
            <div className={`vdPill vdPill--${systemTone}`}>{systemTone === 'ok' ? 'SAFE' : systemTone === 'warn' ? 'WARNING' : 'CRITICAL'}</div>
          </div>
          <div className="vdStatusSub">{systemSub}</div>
        </div>
      </div>
    </div>
  )
}
