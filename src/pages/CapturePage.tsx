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

export function CapturePage() {
  const { token } = useParams<{ token: string }>();
  const { data: session, isLoading, isError } = usePublicCaptureSession(token);
  const submitPhoto = useSubmitCapturePhoto();
  const completeSession = useCompleteCaptureSession();

  const [phase, setPhase] = useState<Phase>('intro');
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
      // Flips phase to 'live', which is what actually mounts the <video>
      // element below (it doesn't exist yet during 'requesting-camera') —
      // the effect below attaches the stream once that element is real.
      setPhase('live');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Camera access was blocked.');
      setPhase('permission-error');
    }
  }

  // Attaches the already-acquired stream once the <video> element actually
  // exists in the DOM (it's conditionally rendered on phase === 'live', so
  // it isn't there yet at the moment startCamera's getUserMedia resolves).
  // Re-runs on every phase flip back to 'live' (e.g. after a retake) in
  // case the element was unmounted/remounted, which is a harmless no-op
  // when the stream's already attached. Sets .muted as a real DOM property,
  // not just React's muted prop — iOS Safari only honors the property for
  // inline autoplay of a live camera stream.
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== 'live' || !video || !streamRef.current) return;
    video.muted = true;
    video.srcObject = streamRef.current;
    video.play().catch((e) => {
      setErrorMsg(e instanceof Error ? e.message : 'Could not start the camera preview.');
      setPhase('permission-error');
    });
  }, [phase]);

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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      if (token) await completeSession.mutateAsync(token);
    } catch {
      // Photos are already safely uploaded one-by-one — a failure here is
      // just the "mark complete + notify" courtesy step, not data loss.
    }
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

      {(phase === 'live' || phase === 'uploading' || phase === 'upload-error') && currentStep && (
        <>
          <div className="relative flex-1 overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))]">
              <div className="mb-2 flex gap-1">
                {queue.map((s, i) => (
                  <div key={s.id} className={`h-1 flex-1 rounded-full ${i < index ? 'bg-white' : i === index ? 'bg-white/70' : 'bg-white/20'}`} />
                ))}
              </div>
              <div className="text-[12px] font-medium uppercase tracking-wide text-white/60">{progressLabel}</div>
              <div className="mt-0.5 text-[13px] text-white/80">{currentStep.hint}</div>
            </div>
          </div>
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
              disabled={phase === 'uploading'}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-[4px] border-white/80 bg-white/10 active:scale-95"
              aria-label="Take photo"
            >
              <div className="h-14 w-14 rounded-full bg-white" />
            </button>
            <div className="w-10" />
          </div>
          {phase === 'upload-error' && (
            <div className="absolute inset-x-0 bottom-28 mx-auto w-fit rounded-full bg-danger px-4 py-2 text-[13px] font-medium text-white">
              {errorMsg ?? 'Upload failed'} — <button className="underline" onClick={usePhoto}>Retry</button>
            </div>
          )}
        </>
      )}

      {phase === 'preview' && previewUrl && currentStep && (
        <>
          <div className="relative flex-1 overflow-hidden bg-black">
            <img src={previewUrl} alt={currentStep.title} className="h-full w-full object-contain" />
          </div>
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
        </>
      )}

      {phase === 'uploading' && !currentStep && <CenteredMessage>Uploading…</CenteredMessage>}

      {phase === 'repeat-prompt' && currentStep && (
        <CenteredMessage>
          <div className="flex flex-col items-center gap-4 px-6 text-center">
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
        </CenteredMessage>
      )}

      {phase === 'finishing' && <CenteredMessage>Finishing up…</CenteredMessage>}

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
