import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import './App.css'
import { AUTO_SPEEDS, advanceStep, applyInitialSetup, createDefaultSetup, createRoom, resolveSheriffBadge, resolveSheriffElection } from './game/engine.js'
import { clearHistory, readHistory, saveHistoryRecord } from './game/history.js'
import { ExitConfirmDialog, HistoryScreen, PlayScreen, PrepScreen, SelectScreen } from './components/GameScreens.jsx'

function App() {
  const [screen, setScreen] = useState('select')
  const [room, setRoom] = useState(null)
  const [setup, setSetup] = useState(null)
  const [selectedId, setSelectedId] = useState(1)
  const mode = 'ai'
  const [auto, setAuto] = useState(false)
  const [speed, setSpeed] = useState(AUTO_SPEEDS[1])
  const [advancing, setAdvancing] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [history, setHistory] = useState(() => readHistory())
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)

  const create = useCallback((count) => {
    const next = createRoom(count, mode)
    setRoom(next)
    setSetup(createDefaultSetup(next))
    setSelectedId(1)
    setShowReview(false)
    setShowExitConfirm(false)
    setScreen('prep')
  }, [])

  const recreatePrep = useCallback((count = room?.players.length ?? 9) => {
    const next = createRoom(count, mode)
    setAuto(false)
    setShowReview(false)
    setShowExitConfirm(false)
    setRoom(next)
    setSetup(createDefaultSetup(next))
    setSelectedId(1)
    setScreen('prep')
  }, [room?.players.length])

  const backToSelect = useCallback(() => {
    setAuto(false)
    setShowReview(false)
    setShowExitConfirm(false)
    setRoom(null)
    setSetup(null)
    setScreen('select')
  }, [])

  const openHistory = useCallback(() => {
    const items = readHistory()
    setHistory(items)
    setSelectedHistoryId(items[0]?.id ?? null)
    setScreen('history')
  }, [])

  const clearAllHistory = useCallback(() => {
    clearHistory()
    setHistory([])
    setSelectedHistoryId(null)
  }, [])

  const forceEndToSelect = useCallback(() => {
    setAuto(false)
    setAdvancing(false)
    setShowReview(false)
    setShowExitConfirm(false)
    setRoom(null)
    setSetup(null)
    setScreen('select')
  }, [])

  const start = useCallback(() => {
    setRoom((value) => applyInitialSetup(value, setup))
    setShowExitConfirm(false)
    setScreen('play')
  }, [setup])

  const step = useCallback(async () => {
    if (!room || advancing) return
    setAdvancing(true)
    try {
      const next = await advanceStep(room, { mode })
      setRoom(next)
      if (next.status === 'finished') {
        setAuto(false)
        setHistory(saveHistoryRecord(next))
      }
    } finally {
      setAdvancing(false)
    }
  }, [advancing, mode, room])

  useEffect(() => {
    if (!auto || advancing || room?.status === 'finished' || room?.pendingSheriffElection || room?.pendingSheriffDecision) return undefined
    const timer = window.setTimeout(() => { step() }, speed.value)
    return () => window.clearTimeout(timer)
  }, [auto, advancing, room?.status, room?.pendingSheriffElection, room?.pendingSheriffDecision, speed.value, step])

  useEffect(() => {
    const handler = async ({ canGoBack }) => {
      if (showReview) {
        setShowReview(false)
        return
      }
      if (showExitConfirm) {
        setShowExitConfirm(false)
        return
      }
      if (screen === 'play') {
        setAuto(false)
        setShowExitConfirm(true)
        return
      }
      if (screen === 'prep' || screen === 'history') {
        backToSelect()
        return
      }
      if (canGoBack && window.history.length > 1) {
        window.history.back()
        return
      }
      await CapacitorApp.exitApp()
    }

    let removed = false
    let listener = null
    CapacitorApp.addListener('backButton', handler).then((handle) => {
      if (removed) handle.remove()
      else listener = handle
    })

    return () => {
      removed = true
      listener?.remove()
    }
  }, [backToSelect, screen, showExitConfirm, showReview])

  const resolveBadge = useCallback((action) => setRoom((value) => resolveSheriffBadge(value, action)), [])
  const resolveElection = useCallback((action) => setRoom((value) => resolveSheriffElection(value, action)), [])
  const reset = useCallback(() => { forceEndToSelect() }, [forceEndToSelect])
  const requestExitGame = useCallback(() => {
    setAuto(false)
    setShowExitConfirm(true)
  }, [])

  const content = useMemo(() => {
    if (screen === 'select') return <SelectScreen historyCount={history.length} onCreate={create} onHistory={openHistory} />
    if (screen === 'history') return <HistoryScreen history={history} selectedHistoryId={selectedHistoryId} setSelectedHistoryId={setSelectedHistoryId} onBack={backToSelect} onClear={clearAllHistory} />
    if (screen === 'prep' && room && setup) return <PrepScreen room={room} setup={setup} setSetup={setSetup} onBack={backToSelect} onRefresh={() => recreatePrep(room.players.length)} onStart={start} />
    if (screen === 'play' && room) return <PlayScreen room={room} selectedId={selectedId} setSelectedId={setSelectedId} auto={auto} setAuto={setAuto} speed={speed} setSpeed={setSpeed} advancing={advancing} showReview={showReview} setShowReview={setShowReview} onBack={requestExitGame} onStep={step} onReset={reset} onSheriff={resolveBadge} onSheriffElection={resolveElection} />
    return null
  }, [advancing, auto, backToSelect, clearAllHistory, create, history, openHistory, recreatePrep, requestExitGame, reset, resolveBadge, resolveElection, room, screen, selectedHistoryId, selectedId, setup, speed, showReview, start, step])

  return (
    <>
      {content}
      {showExitConfirm && <ExitConfirmDialog onCancel={() => setShowExitConfirm(false)} onConfirm={forceEndToSelect} />}
    </>
  )
}

export default App
