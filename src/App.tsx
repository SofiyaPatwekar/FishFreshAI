import { useState, useRef, useEffect, useCallback, type DragEvent, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisState = 'empty' | 'positioning' | 'preview' | 'analyzing' | 'result'
type ResultType = 'fresh' | 'spoiled'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')

interface FileInfo {
  name: string
  sizeStr: string
  dimensions: string
  url: string
}

interface AnalysisResult {
  prediction: ResultType
  confidence: number
  freshProb: number
  spoiledProb: number
  processingTime: string
  probabilitySpoiled: number
  thresholdUsed: number
  heatmapUrl: string
}

const STAGES = [
  'Image received',
  'Preparing image',
  'Analyzing visual features',
  'Generating prediction',
  'Preparing explanation',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function normalizePrediction(payload: unknown, processingTime: string): AnalysisResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('The prediction service returned an invalid response.')
  }

  const result = payload as Record<string, unknown>
  const label = typeof result.label === 'string' ? result.label.toLowerCase() : ''
  const confidence = result.confidence_pct
  const probabilitySpoiled = result.probability_spoiled
  const thresholdUsed = result.threshold_used
  const heatmap = result.heatmap_png_base64

  if (
    (label !== 'fresh' && label !== 'spoiled')
    || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100
    || typeof probabilitySpoiled !== 'number' || !Number.isFinite(probabilitySpoiled) || probabilitySpoiled < 0 || probabilitySpoiled > 1
    || typeof thresholdUsed !== 'number' || !Number.isFinite(thresholdUsed)
    || typeof heatmap !== 'string' || heatmap.length === 0
  ) {
    throw new Error('The prediction service returned incomplete or invalid results.')
  }

  const heatmapUrl = heatmap.startsWith('data:image/')
    ? heatmap
    : `data:image/png;base64,${heatmap}`
  const spoiledProb = probabilitySpoiled * 100

  return {
    prediction: label,
    confidence,
    freshProb: 100 - spoiledProb,
    spoiledProb,
    processingTime,
    probabilitySpoiled,
    thresholdUsed,
    heatmapUrl,
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconUpload({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 7v16" stroke="#1e65aa" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M10 13l6-6 6 6" stroke="#1e65aa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 24h20" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    </svg>
  )
}

function IconCheck({ color = '#16a34a', size = 16 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill={color}/>
      <path d="M5 8l2.5 2.5L11 6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconRefresh({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 8C2 4.686 4.686 2 8 2a6.003 6.003 0 015.659 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M2 5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 8c0 3.314-2.686 6-6 6a6.003 6.003 0 01-5.659-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M14 11v-3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconInfo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#0891b2" strokeWidth="1.5"/>
      <path d="M8 5v1M8 8v3" stroke="#0891b2" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function FishFreshLogo() {
  return (
    <svg viewBox="0 0 44 44" fill="none" style={{ width: 42, height: 42 }} role="img" aria-label="FishFresh AI fish tail">
      <rect width="44" height="44" rx="13" fill="#eef6fd"/>
      <path d="M25.2 22C29.2 17.4 32.5 12.3 34.2 8.5C27.1 9.7 21.8 13.4 18.8 18.2L25.2 22Z" fill="#1e65aa"/>
      <path d="M25.2 22C29.2 26.6 32.5 31.7 34.2 35.5C27.1 34.3 21.8 30.6 18.8 25.8L25.2 22Z" fill="#0891b2"/>
      <path d="M25.2 22L18.8 18.2C16.4 20.1 13.4 21.4 9.8 22C13.4 22.6 16.4 23.9 18.8 25.8L25.2 22Z" fill="#0ea5a4"/>
      <path d="M27.4 15.2C29.7 12.7 32.1 10.7 34.2 8.5C30.5 9.1 27.2 10.4 24.5 12.3L27.4 15.2Z" fill="#16a34a" opacity="0.7"/>
      <path d="M12.2 30.8C17.7 28.5 21.1 28.5 25.3 30" stroke="#1e65aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.28"/>
    </svg>
  )
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      background: 'rgba(255,255,255,0.96)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #e2ebf0',
      boxShadow: '0 1px 8px rgba(11,48,96,0.07)',
    }}>
      <div style={{ width: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 clamp(10px, 4vw, 24px)', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'clamp(6px, 2vw, 16px)', overflow: 'hidden' }}>
        {/* Logo */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          aria-label="Back to top"
        >
          <FishFreshLogo />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0b3060', letterSpacing: '-0.02em' }}>
            FishFresh<span style={{ color: '#0891b2' }}>AI</span>
          </span>
        </button>

        {/* AI status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto',
          padding: '5px 14px', background: '#f0fdf4',
          borderRadius: 100, border: '1px solid #dcfce7', flexShrink: 0,
        }}>
          <span className="anim-pulse-dot" style={{
            display: 'block', width: 8, height: 8, borderRadius: '50%',
            background: '#16a34a', boxShadow: '0 0 0 3px rgba(22,163,74,0.2)',
          }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#15803d', whiteSpace: 'nowrap' }}>
            AI Model Online
          </span>
        </div>

      </div>
    </nav>
  )
}

// ─── Upload Card ──────────────────────────────────────────────────────────────

function LiveCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (file: File) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const requestRef = useRef(0)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Starting camera…')

  const stopCamera = useCallback(() => {
    requestRef.current += 1
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    stopCamera()
    const requestId = requestRef.current
    setMessage('Starting camera…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (requestId !== requestRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setReady(true)
      setMessage('')
    } catch {
      stopCamera()
      setMessage('Camera access is unavailable. Check your browser permissions and try again.')
    }
  }, [stopCamera])

  useEffect(() => {
    void startCamera()
    return stopCamera
  }, [startCamera, stopCamera])

  const capture = () => {
    const video = videoRef.current
    if (!ready || !video?.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      stopCamera()
      onCapture(new File([blob], `fish-eye-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="live-capture-card anim-fade-in-up">
      <div className="live-capture-heading">
        <span>Live Camera</span>
        <h2>Capture Fish Eye Photo</h2>
        <p>Fit the fish&apos;s eye inside the circle</p>
      </div>

      <div className="live-viewfinder">
        <video ref={videoRef} autoPlay muted playsInline className={ready ? 'is-ready' : ''} />
        {!ready && (
          <div className="live-camera-message">
            <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden="true">
              <rect x="5" y="11" width="32" height="24" rx="6" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M14 11l2.5-4h9L28 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="21" cy="23" r="7" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
            <p>{message}</p>
            {message !== 'Starting camera…' && (
              <button onClick={() => void startCamera()}>Try Again</button>
            )}
          </div>
        )}
        <div className="live-capture-instructions">
          <p>Fit the fish&apos;s eye inside the circle</p>
          <span>Move closer until the eye fills the frame</span>
        </div>
        <div className="live-guide-ring" aria-hidden="true"><span /></div>
      </div>

      <div className="live-capture-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="camera-shutter-button" onClick={capture} disabled={!ready} aria-label="Take photo">
          <span />
        </button>
        <div className="live-action-spacer" aria-hidden="true" />
      </div>
      <p className="live-lighting-hint">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M5.7 10.8h4.6M6.25 13h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M4.3 6.4a3.7 3.7 0 117.4 0c0 1.35-.72 2.24-1.48 3.05-.4.43-.62.85-.66 1.25H6.44c-.04-.4-.26-.82-.66-1.25C5.02 8.64 4.3 7.75 4.3 6.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
        Good lighting helps accuracy
      </p>
    </div>
  )
}

function UploadCard({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = (file: File) => {
    if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) onFile(file)
  }

  const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) accept(f)
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) accept(f)
  }

  if (showCamera) {
    return (
      <LiveCapture
        onCapture={accept}
        onCancel={() => setShowCamera(false)}
      />
    )
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', width: '100%' }}>
      <div
        className={`upload-zone${dragging ? ' drag-over' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div style={{
          width: 80, height: 80, margin: '0 auto 24px',
          background: '#eef6fd', borderRadius: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconUpload size={36} />
        </div>

        <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0b3060', marginBottom: 8 }}>
          Upload a fish photo
        </h3>
        <p style={{ fontSize: '0.95rem', color: '#6b7280', marginBottom: 20 }}>
          Drag &amp; drop your image here
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 20 }}>
          <div style={{ flex: 1, maxWidth: 60, height: 1, background: '#e2ebf0' }} />
          <span style={{ fontSize: '0.83rem', color: '#9ca3af' }}>or</span>
          <div style={{ flex: 1, maxWidth: 60, height: 1, background: '#e2ebf0' }} />
        </div>

        <button
          className="btn-primary"
          onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
          style={{ fontSize: '0.92rem' }}
        >
          Browse Image
        </button>
        <button
          className="capture-live-button"
          onClick={e => { e.stopPropagation(); setShowCamera(true) }}
        >
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="2" y="4.5" width="14" height="10.5" rx="3" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6.2 4.5l1-2h3.6l1 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="9" cy="9.75" r="2.75" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Capture Live Image
        </button>

        <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 14 }}>
          JPG, JPEG or PNG &nbsp;·&nbsp; Max 10 MB
        </p>

        <div style={{
          marginTop: 20, padding: '10px 16px',
          background: '#f0f9ff', borderRadius: 10,
          border: '1px solid #bae6fd',
          display: 'inline-flex', alignItems: 'flex-start', gap: 8,
          textAlign: 'left', maxWidth: 420,
        }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><IconInfo size={15} /></span>
          <span style={{ fontSize: '0.78rem', color: '#0369a1', lineHeight: 1.45 }}>
            For best results, use a clear, well-lit photo where the fish is clearly visible.
          </span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        style={{ display: 'none' }}
        onChange={onChange}
      />
    </div>
  )
}

// ─── Fish Eye Positioning ─────────────────────────────────────────────────────

function PositionFishEye({
  fileInfo,
  onConfirm,
  onError,
  onChooseDifferent,
  error,
}: {
  fileInfo: FileInfo
  onConfirm: (url: string, size: number, blob: Blob) => void
  onError: (message: string) => void
  onChooseDifferent: () => void
  error: string | null
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [baseScale, setBaseScale] = useState(1)
  const [zoom, setZoom] = useState(1.15)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const getGeometry = useCallback((nextZoom = zoom) => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image?.naturalWidth || !image.naturalHeight) return null
    const guideSize = Math.min(frame.clientWidth, frame.clientHeight) * 0.7
    const scale = baseScale * nextZoom
    const displayWidth = image.naturalWidth * scale
    const displayHeight = image.naturalHeight * scale
    return {
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      guideSize,
      scale,
      displayWidth,
      displayHeight,
      maxX: Math.max(0, (displayWidth - guideSize) / 2),
      maxY: Math.max(0, (displayHeight - guideSize) / 2),
    }
  }, [baseScale, zoom])

  const constrainOffset = useCallback((x: number, y: number, nextZoom = zoom) => {
    const geometry = getGeometry(nextZoom)
    if (!geometry) return { x, y }
    return {
      x: Math.max(-geometry.maxX, Math.min(geometry.maxX, x)),
      y: Math.max(-geometry.maxY, Math.min(geometry.maxY, y)),
    }
  }, [getGeometry, zoom])

  const initializeImage = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image?.naturalWidth || !image.naturalHeight) return
    const guideSize = Math.min(frame.clientWidth, frame.clientHeight) * 0.7
    setBaseScale(Math.max(guideSize / image.naturalWidth, guideSize / image.naturalHeight))
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    const onResize = () => initializeImage()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [initializeImage])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
    setDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(constrainOffset(
      drag.originX + event.clientX - drag.startX,
      drag.originY + event.clientY - drag.startY,
    ))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const handleZoom = (value: number) => {
    setZoom(value)
    setOffset(current => constrainOffset(current.x, current.y, value))
  }

  const confirmCrop = () => {
    const image = imageRef.current
    const geometry = getGeometry()
    if (!image || !geometry) return

    const imageLeft = geometry.frameWidth / 2 + offset.x - geometry.displayWidth / 2
    const imageTop = geometry.frameHeight / 2 + offset.y - geometry.displayHeight / 2
    const guideLeft = geometry.frameWidth / 2 - geometry.guideSize / 2
    const guideTop = geometry.frameHeight / 2 - geometry.guideSize / 2
    const sourceX = (guideLeft - imageLeft) / geometry.scale
    const sourceY = (guideTop - imageTop) / geometry.scale
    const sourceSize = geometry.guideSize / geometry.scale

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) {
      onError('Could not prepare the cropped image. Please try again.')
      return
    }
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    canvas.toBlob(blob => {
      if (!blob) {
        onError('Could not prepare the cropped image. Please try again.')
        return
      }
      const reader = new FileReader()
      reader.onload = event => {
        if (typeof event.target?.result !== 'string') {
          onError('Could not read the cropped image. Please try again.')
          return
        }
        onConfirm(event.target.result, blob.size, blob)
      }
      reader.onerror = () => onError('Could not read the cropped image. Please try again.')
      reader.readAsDataURL(blob)
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="position-eye-card anim-fade-in-up">
      <div className="position-eye-heading">
        <span>Eye Alignment</span>
        <h2>Position the Fish Eye</h2>
        <p>Drag and zoom to fit the fish&apos;s eye inside the circle</p>
      </div>
      {error && (
        <p role="alert" style={{
          color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: '0.85rem',
        }}>
          {error}
        </p>
      )}

      <div
        ref={frameRef}
        className={`eye-position-frame${dragging ? ' is-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          ref={imageRef}
          src={fileInfo.url}
          alt="Position the selected fish eye"
          draggable={false}
          onLoad={initializeImage}
          style={{
            width: imageRef.current ? imageRef.current.naturalWidth * baseScale * zoom : 'auto',
            height: imageRef.current ? imageRef.current.naturalHeight * baseScale * zoom : 'auto',
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
          }}
        />
        <div className="eye-guide-ring" aria-hidden="true"><span /></div>
        <div className="drag-hint" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2v14M2 9h14M9 2L6.5 4.5M9 2l2.5 2.5M9 16l-2.5-2.5M9 16l2.5-2.5M2 9l2.5-2.5M2 9l2.5 2.5M16 9l-2.5-2.5M16 9l-2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Drag to reposition
        </div>
      </div>

      <div className="zoom-control">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="4.75" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M5.5 7.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          onChange={event => handleZoom(Number(event.target.value))}
          aria-label="Image zoom"
        />
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="4.75" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M5.5 7.5h4M7.5 5.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </div>

      <button className="btn-primary position-confirm" onClick={confirmCrop}>Confirm</button>
      <button className="choose-different" onClick={onChooseDifferent}>Choose Different Image</button>
    </div>
  )
}

// ─── Image Preview Card ───────────────────────────────────────────────────────

function ImagePreviewCard({
  fileInfo, onChange, onAnalyze, error,
}: {
  fileInfo: FileInfo
  onChange: () => void
  onAnalyze: () => void
  error: string | null
}) {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', width: '100%' }}>
      <div className="card-lg" style={{ overflow: 'hidden' }}>
        {/* Preview image */}
        <div style={{ position: 'relative', background: '#0b3060', aspectRatio: '16 / 9', overflow: 'hidden' }}>
          <img
            src={fileInfo.url}
            alt="Uploaded fish"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <button className="btn-ghost" onClick={onChange} style={{ position: 'absolute', top: 12, right: 12 }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1.5 6.5a5 5 0 1110 0" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M1.5 4v2.5h2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Change
          </button>
        </div>

        <div style={{ padding: '22px 26px 26px' }}>
          {/* Quality check */}
          <div style={{
            background: '#f0fdf4', border: '1px solid #dcfce7',
            borderRadius: 10, padding: '12px 16px', marginBottom: 20,
          }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#15803d', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 9 }}>
              Image Quality
            </p>
            {['Fish detected in frame', 'Image resolution sufficient', 'Lighting acceptable'].map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <IconCheck size={15} />
                <span style={{ fontSize: '0.83rem', color: '#166534' }}>{t}</span>
              </div>
            ))}
          </div>

          {/* File meta */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 22, flexWrap: 'wrap' }}>
            {[
              { label: 'File Name', value: fileInfo.name },
              { label: 'File Size', value: fileInfo.sizeStr },
              { label: 'Dimensions', value: fileInfo.dimensions },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
                  {label}
                </p>
                <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1f2937', fontFamily: "'JetBrains Mono', monospace" }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Actions */}
          {error && (
            <p role="alert" style={{
              color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: '0.85rem',
            }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn-primary" onClick={onAnalyze} style={{ flex: 1 }}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                <circle cx="8.5" cy="8.5" r="7" stroke="white" strokeWidth="1.5"/>
                <path d="M6 8.5l2 2 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Analyze Fish
            </button>
            <button className="btn-secondary" onClick={onChange}>Change Image</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Analyzing State ──────────────────────────────────────────────────────────

function AnalyzingState() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStage(current => Math.min(current + 1, STAGES.length - 1))
    }, 700)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', textAlign: 'center' }}>
      {/* Spinner */}
      <div style={{ position: 'relative', width: 88, height: 88, margin: '0 auto 32px' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid #e2ebf0' }} />
        <div
          className="anim-spin"
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '3px solid transparent',
            borderTopColor: '#1e65aa',
            borderRightColor: '#0891b2',
          }}
        />
        <div style={{
          position: 'absolute', inset: 10, borderRadius: '50%',
          background: '#eef6fd',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 44 30" fill="none" style={{ width: 38, height: 26 }}>
            <ellipse cx="19" cy="15" rx="13" ry="8" fill="#1e65aa"/>
            <path d="M32 15L41 7.5L41 22.5Z" fill="#185291"/>
            <circle cx="10" cy="13.5" r="2.8" fill="white"/>
            <circle cx="10" cy="13.5" r="1.3" fill="#061825"/>
            <path d="M26 3.5L28 8L26 12.5L24 8Z" fill="#0ea5e9"/>
          </svg>
        </div>
      </div>

      <h2 style={{ fontSize: '1.55rem', fontWeight: 800, color: '#0b3060', marginBottom: 10 }}>
        Analyzing your fish…
      </h2>
      <p style={{ fontSize: '0.93rem', color: '#6b7280', marginBottom: 36, lineHeight: 1.6 }}>
        AI is examining visual characteristics and generating a freshness prediction.
      </p>

      {/* Stage list */}
      <div className="card-lg" style={{ textAlign: 'left', padding: '24px 28px' }}>
        {STAGES.map((s, i) => {
          const done = i < stage
          const active = i === stage
          return (
            <div
              key={s}
              style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: i < STAGES.length - 1 ? 18 : 0 }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? '#16a34a' : active ? '#1e65aa' : '#f3f4f6',
                transition: 'background 0.3s',
              }}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : active ? (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <span className="dot-bounce-1" style={{ width: 4, height: 4, borderRadius: '50%', background: 'white', display: 'block' }} />
                    <span className="dot-bounce-2" style={{ width: 4, height: 4, borderRadius: '50%', background: 'white', display: 'block' }} />
                    <span className="dot-bounce-3" style={{ width: 4, height: 4, borderRadius: '50%', background: 'white', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db' }} />
                )}
              </div>
              <span style={{
                fontSize: '0.9rem',
                fontWeight: done ? 500 : active ? 700 : 400,
                color: done ? '#374151' : active ? '#0b3060' : '#9ca3af',
                transition: 'color 0.3s, font-weight 0.3s',
              }}>
                {s}
              </span>
              {active && (
                <span style={{
                  marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 600,
                  color: '#0891b2', fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.04em',
                }}>
                  PROCESSING
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Attention Map ────────────────────────────────────────────────────────────

function AttentionMap({ url }: { url: string }) {
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', background: '#111' }}>
      <img
        src={url}
        alt="AI attention heatmap overlay"
        style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', display: 'block' }}
      />
      {/* Label */}
      <div style={{
        position: 'absolute', bottom: 10, left: 10,
        background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(8px)',
        color: 'white', padding: '4px 10px', borderRadius: 6,
        fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        AI ATTENTION MAP
      </div>
    </div>
  )
}

// ─── Result View ──────────────────────────────────────────────────────────────

function ResultView({
  fileInfo, result, onReset,
}: {
  fileInfo: FileInfo
  result: AnalysisResult
  onReset: () => void
}) {
  const fresh = result.prediction === 'fresh'
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    setAnimated(false)
    const t = setTimeout(() => setAnimated(true), 200)
    return () => clearTimeout(t)
  }, [result])

  const freshColor = '#16a34a'
  const spoiledColor = '#dc2626'
  const color = fresh ? freshColor : spoiledColor
  const spoiledProbabilityPercent = result.spoiledProb
  const thresholdPercent = result.thresholdUsed * 100
  const thresholdMarkerPosition = Math.min(100, Math.max(0, thresholdPercent))
  const formatPercent = (value: number) => `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`

  return (
    <div className="anim-fade-in-up" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      {/* Section label */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{
          display: 'inline-block', fontSize: '0.7rem', fontWeight: 800,
          color: '#0891b2', letterSpacing: '0.14em', textTransform: 'uppercase',
          background: '#e0f7fa', padding: '4px 14px', borderRadius: 100, marginBottom: 12,
        }}>
          Analysis Result
        </span>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0b3060' }}>
          AI Freshness Prediction
        </h2>
      </div>

      {/* Main prediction grid */}
      <div className="result-grid" style={{ marginBottom: 20 }}>
        {/* Fish image */}
        <div className="result-image-card" style={{
          borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(11,48,96,0.12)',
          background: '#0b3060',
        }}>
          <img src={fileInfo.url} alt="Analyzed fish" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>

        {/* Prediction card */}
        <div style={{
          borderRadius: 16,
          border: `2px solid ${fresh ? '#dcfce7' : '#fee2e2'}`,
          background: fresh
            ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
            : 'linear-gradient(135deg, #fff5f5 0%, #fee2e2 100%)',
          padding: '36px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
          boxShadow: `0 4px 24px ${fresh ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)'}`,
        }}>
          {/* Result icon */}
          <div style={{
            width: 76, height: 76, borderRadius: '50%', marginBottom: 20,
            background: fresh ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {fresh ? (
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="17" stroke={freshColor} strokeWidth="2.5"/>
                <path d="M11 20l7 7 12-12" stroke={freshColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M20 5L36 34H4L20 5Z" stroke={spoiledColor} strokeWidth="2.5" strokeLinejoin="round" fill="rgba(220,38,38,0.06)"/>
                <path d="M20 16v8" stroke={spoiledColor} strokeWidth="2.5" strokeLinecap="round"/>
                <circle cx="20" cy="29" r="2" fill={spoiledColor}/>
              </svg>
            )}
          </div>

          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: color, color: 'white',
            padding: '5px 18px', borderRadius: 100,
            fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', marginBottom: 18,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.7)', display: 'block' }} />
            {fresh ? 'FRESH' : 'SPOILED'}
          </div>

          {/* Confidence */}
          <p style={{ fontSize: '3.4rem', fontWeight: 800, color, lineHeight: 1, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
            {result.confidence}%
          </p>
          <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: 20, letterSpacing: '0.04em' }}>
            confidence score
          </p>

          {/* {!fresh && (
            <div style={{ width: '100%', maxWidth: 300, marginBottom: 12 }}>
              <div
                role="img"
                aria-label={`Spoiled probability ${formatPercent(spoiledProbabilityPercent)}; flag threshold ${formatPercent(thresholdPercent)}`}
                style={{ position: 'relative', height: 7, borderRadius: 100, background: '#f3f4f6' }}
              >
                <div style={{
                  width: `${spoiledProbabilityPercent}%`,
                  height: '100%',
                  borderRadius: 100,
                  background: spoiledColor,
                  opacity: 0.72,
                }} />
                <div style={{
                  position: 'absolute',
                  left: `${thresholdMarkerPosition}%`,
                  top: -3,
                  height: 13,
                  borderLeft: `2px solid ${spoiledColor}`,
                }} />
              </div>
              <div className="spoiled-threshold-captions">
                <span style={{ whiteSpace: 'nowrap' }}>Flag threshold: {formatPercent(thresholdPercent)}</span>
                <span style={{ color: spoiledColor, whiteSpace: 'nowrap' }}>
                  Spoiled probability: {formatPercent(spoiledProbabilityPercent)}
                </span>
              </div>
            </div>
          )} */}

          <p style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.65, maxWidth: 280 }}>
            {fresh
              ? 'The AI model predicts this fish is likely fresh based on visual characteristics detected in the image.'
              : `This fish was flagged as spoiled because its spoiled probability (${formatPercent(spoiledProbabilityPercent)}) exceeds the model's cautious ${formatPercent(thresholdPercent)} threshold. The low threshold is intentional: it favors catching possible spoilage over avoiding false alarms.`}
          </p>
        </div>
      </div>

      {/* Probability bars */}
      <div className="card" style={{ padding: '28px 28px 26px', marginBottom: 20 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0b3060', marginBottom: 4 }}>Model Prediction</h3>
        <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: 22 }}>
          Probability distribution across both output classes
        </p>

        {[
          { label: 'Fresh', prob: result.freshProb, color: freshColor },
          { label: 'Spoiled', prob: result.spoiledProb, color: spoiledColor },
        ].map(({ label, prob, color: c }) => (
          <div key={label} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 11, height: 11, borderRadius: 3, background: c, flexShrink: 0 }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>{label}</span>
              </div>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: c, fontFamily: "'JetBrains Mono', monospace" }}>
                {prob}%
              </span>
            </div>
            <div className="prob-bar-track">
              <div
                className="prob-bar-fill"
                style={{ width: animated ? `${prob}%` : '0%', background: c, opacity: 0.82 }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* AI Explanation */}
      <div className="card" style={{ padding: '28px', marginBottom: 20 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0b3060', marginBottom: 4 }}>
           Model Explanation
        </h3>
        <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: 20 }}>
          Grad-CAM highlights the regions that contributed most to the model's prediction.</p>

        <div className="attention-grid">
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Original Image
            </p>
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2ebf0' }}>
              <img src={fileInfo.url} alt="Original fish" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
            </div>
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Grad-CAM
            </p>
            <AttentionMap url={result.heatmapUrl} />
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: '#9ca3af' }}>Model attention intensity:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 90, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, #22c55e, #eab308, #f97316, #ef4444)' }} />
            <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Low → High</span>
          </div>
        </div>
      </div>

      {/* Analysis Details */}
      <div className="card" style={{ padding: '28px', marginBottom: 28 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0b3060', marginBottom: 20 }}>Analysis Details</h3>
        <div className="details-grid">
          {[
            { label: 'Prediction', value: fresh ? 'Fresh' : 'Spoiled', color },
            { label: 'Confidence', value: `${result.confidence}%`, color: undefined },
            { label: 'Probability Spoiled', value: `${(result.probabilitySpoiled * 100).toFixed(1)}%`, color: undefined },
            { label: 'Threshold Used', value: `${result.thresholdUsed}`, color: undefined },
            { label: 'Classification', value: 'Binary', color: undefined },
            { label: 'Input', value: 'Fish photograph', color: undefined },
            { label: 'Model', value: 'CNN classifier', color: undefined },
            { label: 'Processing Time', value: `${result.processingTime} sec`, color: undefined },
          ].map(({ label, value, color: c }) => (
            <div key={label} style={{
              padding: '13px 15px',
              background: '#f8fbff', borderRadius: 10,
              border: '1px solid #e2ebf0',
            }}>
              <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {label}
              </p>
              <p style={{ fontSize: '0.88rem', fontWeight: 700, color: c || '#1f2937', fontFamily: "'JetBrains Mono', monospace" }}>
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        <button className="btn-primary" onClick={onReset}>
          <IconRefresh size={15} />
          Analyze Another Fish
        </button>
      </div>
    </div>
  )
}

// ─── How It Works Section (compact, for dashboard) ────────────────────────────

function HowItWorksSection() {
  const steps = [
    {
      n: '01', title: 'UPLOAD',
      desc: 'Upload a clear photo of a fish from your device or drag and drop.',
      icon: <IconUpload size={26} />,
    },
    {
      n: '02', title: 'PREPROCESS',
      desc: 'The image is resized, normalized, and prepared for AI input.',
      icon: (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <rect x="3" y="3" width="20" height="20" rx="4" stroke="#1e65aa" strokeWidth="1.8"/>
          <path d="M8 13h10M13 8v10" stroke="#0891b2" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
          <circle cx="13" cy="13" r="3" fill="#eef6fd" stroke="#1e65aa" strokeWidth="1.5"/>
        </svg>
      ),
    },
    {
      n: '03', title: 'AI ANALYSIS',
      desc: 'The CNN analyzes visual patterns and texture characteristics.',
      icon: (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <circle cx="6" cy="6" r="2" stroke="#1e65aa" strokeWidth="1.5"/>
          <circle cx="20" cy="6" r="2" stroke="#1e65aa" strokeWidth="1.5"/>
          <circle cx="6" cy="20" r="2" stroke="#1e65aa" strokeWidth="1.5"/>
          <circle cx="20" cy="20" r="2" stroke="#1e65aa" strokeWidth="1.5"/>
          <circle cx="13" cy="13" r="3.5" fill="rgba(8,145,178,0.15)" stroke="#0891b2" strokeWidth="1.5"/>
          <path d="M8 6h5M6 8v5M18 6h-5M20 8v5M8 20h5M6 18v-5M18 20h-5M20 18v-5" stroke="#1e65aa" strokeWidth="1" opacity="0.45"/>
        </svg>
      ),
    },
    {
      n: '04', title: 'PREDICTION',
      desc: 'Fresh or Spoiled prediction with confidence score and visual explanation.',
      icon: (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <path d="M13 3L23 21H3L13 3Z" fill="#f0fdf4" stroke="#16a34a" strokeWidth="1.8" strokeLinejoin="round"/>
          <path d="M9 15.5l3 3 6-6" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ]

  return (
    <section style={{ marginTop: 80, paddingTop: 64, borderTop: '1px solid #e2ebf0' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#0891b2', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
          THE PROCESS
        </p>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0b3060', marginBottom: 14 }}>
          How It Works
        </h2>
        <p style={{ fontSize: '0.95rem', color: '#6b7280', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
          Four steps from fish photo to freshness prediction.
        </p>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Connector line */}
        <div
          className="step-connector"
          style={{
            position: 'absolute', top: 32, left: 'calc(12.5% + 16px)', right: 'calc(12.5% + 16px)',
            height: 1, background: 'linear-gradient(90deg, #d9edfb 0%, #0891b2 50%, #d9edfb 100%)',
            zIndex: 0,
          }}
        />
        <div className="steps-grid" style={{ position: 'relative', zIndex: 1 }}>
          {steps.map(({ n, title, desc, icon }) => (
            <div key={n} style={{ textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
                background: 'white', border: '2px solid #d9edfb',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(11,48,96,0.09)',
              }}>
                {icon}
              </div>
              <p style={{ fontSize: '0.68rem', fontWeight: 800, color: '#0891b2', letterSpacing: '0.1em', marginBottom: 6 }}>{n}</p>
              <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0b3060', marginBottom: 8 }}>{title}</h3>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.6, maxWidth: 160, margin: '0 auto' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── About Model Section ──────────────────────────────────────────────────────

function AboutModelSection() {
  const stats = [
    { n: '4,392', label: 'Fish Images', sub: 'Training dataset' },
    { n: '8', label: 'Fish Species', sub: 'Covered in dataset' },
    { n: '2', label: 'Output Classes', sub: 'Fresh / Spoiled' },
    // { n: '24', label: 'Freshness Categories', sub: 'Condensed to 2 classes' },
  ]

  return (
    <section style={{ marginTop: 64, paddingTop: 64, borderTop: '1px solid #e2ebf0' }}>
      <div style={{ display: 'flex', gap: 48, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left text */}
        <div style={{ flex: '1 1 280px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#0891b2', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
            ABOUT THE AI MODEL
          </p>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0b3060', marginBottom: 16, lineHeight: 1.25 }}>
            CNN-Based Fish Freshness Classifier
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: 1.75, marginBottom: 20 }}>
            FishFresh AI uses a CNN-based image classification pipeline to distinguish between fresh and spoiled fish.
            The model was trained on a curated dataset of labeled fish photographs across multiple species.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Fresh', sub: 'Highly Fresh + Fresh', color: '#16a34a', bg: '#f0fdf4', border: '#dcfce7' },
              { label: 'Spoiled', sub: 'Not Fresh', color: '#dc2626', bg: '#fff5f5', border: '#fee2e2' },
            ].map(({ label, sub, color, bg, border }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: bg, borderRadius: 10, border: `1px solid ${border}` }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color }}>{label}</span>
                <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>=</span>
                <span style={{ fontSize: '0.82rem', color: '#374151' }}>{sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{ flex: '1 1 320px' }}>
          {stats.map(({ n, label, sub }) => (
            <div key={label} style={{
              textAlign: 'center', padding: '22px 12px',
              background: 'white', borderRadius: 14,
              border: '1px solid #e2ebf0',
              boxShadow: '0 2px 10px rgba(11,48,96,0.05)',
            }}>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#1e65aa', fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>{n}</p>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1f2937', marginBottom: 2 }}>{label}</p>
              <p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

function DashboardPage() {
  const [state, setState] = useState<AnalysisState>('empty')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setAnalysisError(null)
    setCroppedBlob(null)
    const reader = new FileReader()
    reader.onload = e => {
      const url = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        setFileInfo({
          name: file.name,
          sizeStr: formatSize(file.size),
          dimensions: `${img.width} × ${img.height}`,
          url,
        })
        setState('positioning')
      }
      img.src = url
    }
    reader.readAsDataURL(file)
  }, [])

  const handleReset = useCallback(() => {
    setState('empty')
    setFileInfo(null)
    setCroppedBlob(null)
    setResult(null)
    setAnalysisError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleCropConfirm = useCallback((url: string, size: number, blob: Blob) => {
    setFileInfo(current => current ? {
      ...current,
      sizeStr: formatSize(size),
      dimensions: '512 × 512',
      url,
    } : null)
    setCroppedBlob(blob)
    setAnalysisError(null)
    setState('preview')
  }, [])

  const handleAnalyze = useCallback(async () => {
    setAnalysisError(null)
    setState('analyzing')
    const startedAt = performance.now()

    try {
      if (!API_BASE_URL) {
        throw new Error('API URL is not configured. Set VITE_API_BASE_URL and restart the dev server.')
      }
      if (!croppedBlob) {
        throw new Error('The cropped image is unavailable. Please crop the image again.')
      }

      const formData = new FormData()
      formData.append('image', croppedBlob, 'eye.png')

      // const debugUrl = URL.createObjectURL(croppedBlob)
      // window.open(debugUrl)

      const res = await fetch(`${API_BASE_URL}/predict`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Prediction failed: ${res.status}`)
      const result = await res.json()
      const processingTime = ((performance.now() - startedAt) / 1000).toFixed(2)
      setResult(normalizePrediction(result, processingTime))
      setState('result')
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Prediction failed. Please try again.')
      setState('preview')
    }
  }, [croppedBlob])

  const isResult = state === 'result'

  return (
    <div>
      {/* Hero — hidden when showing result */}
      {!isResult && state !== 'positioning' && (
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span style={{
            display: 'inline-block', fontSize: '0.68rem', fontWeight: 800,
            color: '#0891b2', letterSpacing: '0.16em', textTransform: 'uppercase',
            background: '#e0f7fa', padding: '4px 14px', borderRadius: 100, marginBottom: 20,
          }}>
            AI FISH QUALITY ANALYSIS
          </span>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, color: '#0b3060', marginBottom: 16, lineHeight: 1.15 }}>
            Check Fish Freshness<br />with AI
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#6b7280', maxWidth: 500, margin: '0 auto 28px', lineHeight: 1.7 }}>
            Upload a photo of a fish and get an AI-powered freshness prediction in seconds.
          </p>
          {state === 'empty' && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>↓ Upload a JPG, JPEG, or PNG image to get started</span>
            </div>
          )}
        </div>
      )}

      {/* Analysis tool */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {state === 'empty' && <UploadCard onFile={handleFile} />}
        {state === 'positioning' && fileInfo && (
          <PositionFishEye
            fileInfo={fileInfo}
            onConfirm={handleCropConfirm}
            onError={setAnalysisError}
            onChooseDifferent={handleReset}
            error={analysisError}
          />
        )}
        {state === 'preview' && fileInfo && (
          <ImagePreviewCard
            fileInfo={fileInfo}
            onChange={handleReset}
            onAnalyze={handleAnalyze}
            error={analysisError}
          />
        )}
        {state === 'analyzing' && <AnalyzingState />}
        {state === 'result' && fileInfo && result && (
          <ResultView
            fileInfo={fileInfo}
            result={result}
            onReset={handleReset}
          />
        )}
      </div>

      {/* Below-fold sections (only when not analyzing/result) */}
      {(state === 'empty' || state === 'preview') && (
        <>
          <HowItWorksSection />
          <AboutModelSection />
        </>
      )}
    </div>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{
      marginTop: 100, borderTop: '1px solid #e2ebf0',
      background: 'white', padding: '40px 24px',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 28, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FishFreshLogo />
            <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0b3060' }}>
              FishFresh<span style={{ color: '#0891b2' }}>AI</span>
            </span>
          </div>
          <div style={{ maxWidth: 520 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0891b2', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
              About FishFresh AI
            </p>
            <p style={{ fontSize: '0.86rem', color: '#6b7280', lineHeight: 1.65 }}>
              FishFresh AI uses computer vision to make fish freshness screening faster, clearer, and more accessible through explainable image analysis.
            </p>
          </div>
        </div>
        <div style={{ paddingTop: 20, borderTop: '1px solid #e2ebf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            FishFresh AI &mdash; AI-powered fish freshness analysis
          </p>
          <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            {' '}
          </p>
        </div>
      </div>
    </footer>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      <main style={{ flex: 1, paddingTop: 88, paddingBottom: 40, paddingLeft: 24, paddingRight: 24 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <DashboardPage />
        </div>
      </main>

      <Footer />
    </div>
  )
}
