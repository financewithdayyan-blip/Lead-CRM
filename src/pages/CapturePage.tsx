import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, Check, Home, RotateCcw } from 'lucide-react';
import { usePublicCaptureSession, useSubmitCapturePhoto, useCompleteCaptureSession } from '@/hooks/usePhotoCapture';

interface Step {
  id: string;
  category: string;
  title: string;
  hint: string;
  repeatableType?: 'room' | 'bathroom';
  skippable?: boolean;
}

const REPEATABLE_COPY: Record<'room' | 'bathroom', { title: string; hint: string }> = {
  room: { title: 'A room', hint: 'A bedroom, living room, dining room — any room not covered already.' },
  bathroom: { title: 'A bathroom', hint: 'Make sure the whole bathroom is visible.' },
};

function buildInitialQueue(): Step[] {
  return [
    { id: 'ext-front', category: 'Exterior - Front', title: 'Front of the house', hint: 'Stand back so the whole front of the house fits in frame.' },
    { id: 'ext-side', category: 'Exterior - Side', title: 'Side of the house', hint: 'Either side — whichever shows the most.' },
    { id: 'ext-back', category: 'Exterior - Back', title: 'Back of the house', hint: 'The backyard and rear of the house.' },
    { id: 'kitchen', category: 'Kitchen', title: 'Kitchen', hint: 'The whole kitchen, including the appliances.' },
    { id: 'hallway', category: 'Hallway', title: 'Hallway', hint: 'The main hallway.' },
    { id: 'room-1', category: 'Room 1', title: REPEATABLE_COPY.room.title, hint: REPEATABLE_COPY.room.hint, repeatableType: 'room' },
    { id: 'bathroom-1', category: 'Bathroom 1', title: REPEATABLE_COPY.bathroom.title, hint: REPEATABLE_COPY.bathroom.hint, repeatableType: 'bathroom' },
    { id: 'basement', category: 'Basement', title: 'Basement', hint: "If there is one — skip this if your home doesn't have a basement.", skippable: true },
  ];
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

type Phase = 'intro' | 'requesting-camera' | 'permission-error' | 'live' | 'preview' | 'uploading' | 'upload-error' | 'repeat-prompt' | 'finishing' | 'done';

// Phases where the camera has already been granted and should stay mounted
// and streaming underneath whatever overlay that phase shows — the whole
// point being the <video> element is created exactly once, right when the
// camera starts, and never torn down/recreated again (that remount is what
// produced the multi-second black flash between steps: a fresh <video> has
// no frame to show until it's reattached and the browser decodes one).
const CAMERA_MOUNTED_PHASES = new Set<Phase>(['live', 'preview', 'uploading', 'upload-error', 'repeat-prompt', 'finishing']);

export function CapturePage() {
  const { token } = useParams<{ token: string }>();
  const { data: session, isLoading, isError } = usePublicCaptureSession(token);
  const submitPhoto = useSubmitCapturePhoto();
  const completeSession = useCompleteCaptureSession();

  const [phase, setPhase] = useState<Phase>('intro');
  const [cameraStarted, setCameraStarted] = useState(false);
  const [queue, setQueue] = useState<Step[]>(() => buildInitialQueue());
  const [index, setIndex] = useState(0);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentStep = queue[index];
  const totalSteps = queue.length;
  const cameraMounted = cameraStarted && CAMERA_MOUNTED_PHASES.has(phase);

  // Session already completed before (link reused, or opened twice after
  // finishing) — skip straight to the done screen rather than letting them
  // capture a second batch under the same link.
  useEffect(() => {
    if (session?.status === 'completed') setPhase('done');
  }, [session?.status]);

  async function startCamera() {
    setErrorMsg(null);
    setPhase('requesting-camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      // cameraMounted flips true on this same render (phase -> 'live'),
      // which is what actually mounts the <video> element below — the
      // effect right under this one attaches the stream once it's real,
      // and from here on the element is never unmounted again, so every
      // later step/preview/upload transition is just an overlay change.
      setCameraStarted(true);
      setPhase('live');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Camera access was blocked.');
      setPhase('permission-error');
    }
  }

  // Attaches the stream exactly once, the first time the <video> element
  // exists (right as cameraStarted flips true). Sets .muted as a real DOM
  // property, not just React's muted prop — iOS Safari only honors the
  // property for inline autoplay of a live camera stream.
  useEffect(() => {
    const video = videoRef.current;
    if (!cameraStarted || !video || !streamRef.current) return;
    video.muted = true;
    video.srcObject = streamRef.current;
    video.play().catch((e) => {
      setErrorMsg(e instanceof Error ? e.message : 'Could not start the camera preview.');
      setPhase('permission-error');
    });
  }, [cameraStarted]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase('preview');
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setPhase('live');
  }

  async function advancePast(step: Step) {
    if (step.repeatableType) {
      setPhase('repeat-prompt');
      return;
    }
    await moveToNextIndex();
  }

  async function moveToNextIndex() {
    const next = index + 1;
    if (next >= queue.length) {
      await finish();
      return;
    }
    setIndex(next);
    setPhase('live');
  }

  async function usePhoto() {
    if (!capturedBlob || !token || !currentStep) return;
    setPhase('uploading');
    try {
      await submitPhoto.mutateAsync({ token, category: currentStep.category, blob: capturedBlob });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setCapturedBlob(null);
      await advancePast(currentStep);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed.');
      setPhase('upload-error');
    }
  }

  function addAnother() {
    const type = currentStep.repeatableType!;
    const existingOfType = queue.filter((s) => s.repeatableType === type).length;
    const n = existingOfType + 1;
    const copy = REPEATABLE_COPY[type];
    const newStep: Step = { id: `${type}-${n}`, category: `${type === 'room' ? 'Room' : 'Bathroom'} ${n}`, title: copy.title, hint: copy.hint, repeatableType: type };
    const next = [...queue];
    next.splice(index + 1, 0, newStep);
    setQueue(next);
    setIndex(index + 1);
    setPhase('live');
  }

  async function skipStep() {
    await moveToNextIndex();
  }

  async function finish() {
    setPhase('finishing');
    try {
      if (token) await completeSession.mutateAsync(token);
    } catch {
      // Photos are already safely uploaded one-by-one — a failure here is
      // just the "mark complete + notify" courtesy step, not data loss.
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setPhase('done');
  }

  const progressLabel = currentStep ? `Step ${index + 1} of ${totalSteps} — ${currentStep.title}` : '';

  if (isLoading) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (isError || !session) {
    return <CenteredMessage>This link isn't valid or has expired. Please ask your agent to send a new one.</CenteredMessage>;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white" style={{ colorScheme: 'dark' }}>
      {phase === 'intro' && (
        <CenteredMessage>
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
              <Home size={26} />
            </div>
            <h1 className="text-[22px] font-bold">
              {session.firstName ? `Hi ${session.firstName}, let's` : "Let's"} take a few real-time photos
            </h1>
            <p className="max-w-xs text-[14px] text-white/70">
              {session.address ? `For ${session.address}${session.city ? `, ${session.city}` : ''}. ` : ''}
              We'll guide you through each room one at a time — just your camera, nothing to upload.
            </p>
            <button
              onClick={startCamera}
              className="mt-2 flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-black"
            >
              <Camera size={18} /> Proceed
            </button>
          </div>
        </CenteredMessage>
      )}

      {phase === 'requesting-camera' && <CenteredMessage>Opening camera…</CenteredMessage>}

      {phase === 'permission-error' && (
        <CenteredMessage>
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <p className="text-[15px] font-semibold">We need camera access to continue</p>
            <p className="max-w-xs text-[13px] text-white/60">{errorMsg ?? 'Please allow camera access in your browser, then try again.'}</p>
            <button onClick={startCamera} className="mt-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black">
              Try again
            </button>
          </div>
        </CenteredMessage>
      )}

      {/* The camera layer: mounted once (see cameraMounted) and kept alive
          for the rest of the flow. Every phase below layers its own
          overlay and controls on top of it instead of replacing it, so
          switching steps/previewing/uploading never shows a black
          remount gap — only the overlay on top changes. */}
      {cameraMounted && (
        <>
          <div className="relative flex-1 overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

            {phase === 'live' && currentStep && (
              <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))]">
                <div className="mb-2 flex gap-1">
                  {queue.map((s, i) => (
                    <div key={s.id} className={`h-1 flex-1 rounded-full ${i < index ? 'bg-white' : i === index ? 'bg-white/70' : 'bg-white/20'}`} />
                  ))}
                </div>
                <div className="text-[12px] font-medium uppercase tracking-wide text-white/60">{progressLabel}</div>
                <div className="mt-0.5 text-[13px] text-white/80">{currentStep.hint}</div>
              </div>
            )}

            {phase === 'preview' && previewUrl && currentStep && (
              <img src={previewUrl} alt={currentStep.title} className="absolute inset-0 h-full w-full bg-black object-contain" />
            )}

            {(phase === 'uploading' || phase === 'finishing') && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <p className="text-[14px] font-medium text-white/85">{phase === 'uploading' ? 'Uploading…' : 'Finishing up…'}</p>
              </div>
            )}

            {phase === 'upload-error' && (
              <div className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-danger px-4 py-2 text-[13px] font-medium text-white">
                {errorMsg ?? 'Upload failed'} —{' '}
                <button className="underline" onClick={usePhoto}>
                  Retry
                </button>
              </div>
            )}

            {phase === 'repeat-prompt' && currentStep && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center">
                <div className="flex flex-col items-center gap-4">
                  <p className="text-[17px] font-semibold">Got it! Add another {currentStep.repeatableType}?</p>
                  <div className="flex gap-3">
                    <button onClick={addAnother} className="rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black">
                      Yes, add another
                    </button>
                    <button onClick={moveToNextIndex} className="rounded-full border border-white/30 px-5 py-2.5 text-[14px] font-semibold text-white">
                      No, continue
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(phase === 'live' || phase === 'uploading' || phase === 'upload-error') && currentStep && (
            <div className="flex items-center justify-center gap-8 bg-black px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-5">
              {currentStep.skippable ? (
                <button onClick={skipStep} className="text-[13px] font-medium text-white/60">
                  Skip
                </button>
              ) : (
                <div className="w-10" />
              )}
              <button
                onClick={takePhoto}
                disabled={phase !== 'live'}
                className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-[4px] border-white/80 bg-white/10 active:scale-95 disabled:opacity-50"
                aria-label="Take photo"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
              <div className="w-10" />
            </div>
          )}

          {phase === 'preview' && (
            <div className="flex items-center justify-center gap-10 bg-black px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-5">
              <button onClick={retake} className="flex flex-col items-center gap-1.5 text-white/70">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                  <RotateCcw size={22} />
                </span>
                <span className="text-[12px] font-medium">Retake</span>
              </button>
              <button onClick={usePhoto} className="flex flex-col items-center gap-1.5">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success">
                  <Check size={24} className="text-white" />
                </span>
                <span className="text-[12px] font-medium">Use photo</span>
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'done' && (
        <CenteredMessage>
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success">
              <Check size={28} className="text-white" />
            </span>
            <h1 className="text-[20px] font-bold">All done — thank you!</h1>
            <p className="max-w-xs text-[14px] text-white/70">Your photos are on their way to your agent. You can close this page now.</p>
          </div>
        </CenteredMessage>
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black text-white">
      {typeof children === 'string' ? <p className="text-[14px] text-white/70">{children}</p> : children}
    </div>
  );
}
