import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Download, FileSignature, FileText, Loader2, PenLine, Type } from 'lucide-react';
import {
  usePublicSigningParty,
  useSigningPdfUrl,
  useSubmitSignature,
  useDeclineSignature,
  useLogSigningView,
  useRecordConsent,
  useSignedFinalDocUrl,
} from '@/hooks/useContractInstances';
import { loadPdf, type pdfjsLib } from '@/lib/pdfjs';
import { ContractDocumentPage } from '@/components/bluedocs/ContractDocumentPreview';
import { SignaturePad, type SignaturePadHandle } from '@/components/bluedocs/SignaturePad';
import { formatCurrency } from '@/lib/currency';
import { loadSignatureFont, renderTypedSignature, SIGNATURE_FONT } from '@/lib/typedSignature';
import { roleLabel } from '@/hooks/useDocTemplates';

const MAX_PAGE_WIDTH = 680;
const PAGE_CONTAINER_MAX = 720;
const PAGE_CONTAINER_PADDING = 32; // px-4 on each side
const FILLABLE_TYPES = new Set(['text', 'full_name', 'currency', 'date', 'paragraph']);

/** The document was always rendered at a fixed 680px, which overflowed the
 * viewport on a phone and forced sideways scrolling to reach fields. This
 * shrinks it to fit whatever width is actually available, recomputed on
 * resize/rotation, while never exceeding the desktop size. */
function usePageWidth() {
  const compute = () =>
    Math.max(240, Math.min(MAX_PAGE_WIDTH, Math.min(window.innerWidth, PAGE_CONTAINER_MAX) - PAGE_CONTAINER_PADDING));
  const [width, setWidth] = useState(compute);
  useEffect(() => {
    const onResize = () => setWidth(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/** The circle and checkmark trace themselves in on mount (pathLength=1
 * normalizes the dash math regardless of actual geometry), with a soft ring
 * pulse behind for a bit of celebration — see the sign-success-* keyframes
 * in index.css, which also cover prefers-reduced-motion. */
function SignSuccessCheck() {
  return (
    <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
      <span className="sign-success-ring absolute inset-0 rounded-full border-2 border-emerald-400" />
      <svg viewBox="0 0 52 52" className="sign-success-check relative h-20 w-20">
        <circle className="sign-success-circle" cx="26" cy="26" r="24" fill="none" stroke="#10b981" strokeWidth="2.5" pathLength={1} />
        <path
          className="sign-success-tick"
          d="M14 27l7 7 16-16"
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
        />
      </svg>
    </div>
  );
}

/** Shared shell for the loading / invalid-link / waiting-your-turn states —
 * an icon in a soft colored circle, a headline, a line of body copy. Keeps
 * those states visually on par with the success screen instead of reading
 * like a plain error page. */
function StatusScreen({
  icon,
  tone = 'slate',
  spin,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone?: 'slate' | 'primary';
  spin?: boolean;
  title?: string;
  body?: string;
}) {
  const ring = tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400';
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
      <div>
        <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ring} ${spin ? 'animate-spin' : ''}`}>
          {icon}
        </span>
        {title && <p className="mt-4 text-lg font-semibold text-text">{title}</p>}
        {body && <p className="mt-1 max-w-sm text-[13.5px] text-text-3">{body}</p>}
      </div>
    </div>
  );
}

function DownloadCertificateButton({ token, docLabel }: { token: string; docLabel: string }) {
  const getFinalUrl = useSignedFinalDocUrl();

  async function handleDownload() {
    const url = await getFinalUrl.mutateAsync(token);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docLabel} (signed).pdf`;
    a.click();
  }

  return (
    <button
      className="mt-5 flex items-center gap-1.5 rounded-md border border-border bg-white px-4 py-2 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={getFinalUrl.isPending}
      onClick={handleDownload}
    >
      {getFinalUrl.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      Download {docLabel} with Audit Trail
    </button>
  );
}

export function SignContractPage() {
  const { token } = useParams<{ token: string }>();
  const { data: party, isLoading, isError } = usePublicSigningParty(token);
  const getPdfUrl = useSigningPdfUrl();
  const submitSignature = useSubmitSignature();
  const declineSignature = useDeclineSignature();
  const logView = useLogSigningView();
  const recordConsent = useRecordConsent();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declined, setDeclined] = useState(false);
  const [justConsented, setJustConsented] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const pageWidth = usePageWidth();
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [fieldInputs, setFieldInputs] = useState<Record<string, string>>({});
  const [signatureName, setSignatureName] = useState('');
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [hasDrawing, setHasDrawing] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  const loggedRef = useRef(false);
  const seededRef = useRef(false);

  const ready = !!party && party.isTurn && party.status !== 'signed';

  useEffect(() => {
    loadSignatureFont();
  }, []);

  // The tab otherwise just says "BlueBird CRM" — a real giveaway that a
  // seller is clicking a link into someone else's internal software rather
  // than a document made for them.
  useEffect(() => {
    if (party) document.title = party.templateType === 'loi' ? 'LOI' : 'Contract';
  }, [party]);

  // Logged once per page load regardless of turn state — an audit trail
  // needs "did they open it" on record even while they're still waiting.
  useEffect(() => {
    if (!token || !party || loggedRef.current) return;
    loggedRef.current = true;
    logView.mutate(token);
  }, [token, party]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !token) return;
    getPdfUrl.mutateAsync(token).then((url) => loadPdf(url)).then(setPdf);
  }, [ready, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // My own not-yet-filled fields — a full-name one starts pre-filled with
  // the name already on record for me, still editable.
  const myPendingFields = useMemo(
    () => (party?.templateFields ?? []).filter((f) => f.role === party?.role && FILLABLE_TYPES.has(f.type) && !party?.fieldValues[f.id]),
    [party],
  );

  // Nothing to sign if this role has no signature field mapped at all — e.g.
  // an LOI that's purely "we fill it in and send it," with the seller only
  // ever meant to review it, not countersign anything.
  const needsSignature = useMemo(
    () => (party?.templateFields ?? []).some((f) => f.type === 'signature' && f.role === party?.role),
    [party],
  );

  useEffect(() => {
    if (!ready || seededRef.current || !party) return;
    seededRef.current = true;
    setSignatureName(party.name);
    setFieldInputs((prev) => {
      const next = { ...prev };
      for (const f of myPendingFields) {
        if (f.type === 'full_name' && !next[f.id]) next[f.id] = party.name;
      }
      return next;
    });
  }, [ready, party, myPendingFields]);

  const numPages = pdf?.numPages ?? 0;
  const pageNums = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

  const filledCount = myPendingFields.filter((f) => fieldInputs[f.id]?.trim()).length;
  const allFieldsFilled = filledCount === myPendingFields.length;
  const signatureReady = signatureMode === 'draw' ? hasDrawing : !!signatureName.trim();
  const canSubmit = allFieldsFilled && (!needsSignature || signatureReady);

  async function handleSubmit() {
    if (!token || !canSubmit) return;
    let dataUrl: string | undefined;
    if (needsSignature) {
      dataUrl =
        signatureMode === 'draw' && padRef.current && !padRef.current.isEmpty()
          ? padRef.current.toDataUrl()
          : await renderTypedSignature(signatureName.trim());
    }
    const formatted = { ...fieldInputs };
    for (const f of myPendingFields) {
      if (f.type === 'currency' && formatted[f.id]) formatted[f.id] = formatCurrency(formatted[f.id]);
    }
    await submitSignature.mutateAsync({ token, signatureDataUrl: dataUrl, fieldValues: formatted });
    setSubmitted(true);
  }

  if (isLoading) {
    return <StatusScreen icon={<Loader2 size={22} />} spin tone="primary" />;
  }

  if (isError || !party) {
    return (
      <StatusScreen
        icon={<FileText size={24} />}
        title="This link is no longer valid"
        body="It may have already been used, or the contract it points to was removed. Reach out to whoever sent it if that's unexpected."
      />
    );
  }

  if (declined) {
    return (
      <StatusScreen
        icon={<FileText size={24} />}
        title="You've declined to sign"
        body="Whoever sent this has been notified. No further action is needed from you."
      />
    );
  }

  if (party.blocked) {
    return (
      <StatusScreen
        icon={<FileText size={24} />}
        title={party.blocked === 'voided' ? 'This document was voided' : 'This document was declined'}
        body={
          party.blocked === 'voided'
            ? 'Whoever sent this has canceled it — no further action is needed from you.'
            : 'One of the parties declined to sign, so this document is no longer moving forward.'
        }
      />
    );
  }

  if (submitted || party.status === 'signed') {
    const docLabel = party.templateType === 'loi' ? 'LOI' : 'Contract';
    // Never show the download button on the screen right after THIS
    // submission, even if it happened to be the last signature and/or the
    // background poll flips contractStatus to 'signed' a few seconds later
    // — everyone gets a text with their link once the contract is fully
    // signed, and downloading happens from there instead. `submitted` only
    // reflects this page load, so a fresh visit via that texted link (a new
    // mount, submitted starts false again) still shows the button normally.
    const fullyDone = !submitted && party.contractStatus === 'signed';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
        <SignSuccessCheck />
        <p className="mt-3 text-lg font-semibold text-text">
          You've {needsSignature ? 'signed' : 'confirmed'} {party.contractName}
        </p>
        <p className="mt-1 text-[13.5px] text-text-3">
          {fullyDone
            ? 'Every party has completed this document — you can download the final copy below.'
            : "Thank you — once every party has completed signing, we'll text you a link to download the final copy."}
        </p>
        {fullyDone && token && <DownloadCertificateButton token={token} docLabel={docLabel} />}
      </div>
    );
  }

  if (!party.isTurn) {
    return (
      <StatusScreen
        icon={<Clock size={22} />}
        tone="primary"
        title={`Waiting on ${party.waitingOn}`}
        body={`${party.waitingOn} needs to sign ${party.contractName} before it's your turn. This page updates automatically — no need to refresh.`}
      />
    );
  }

  if (!party.hasConsented && !justConsented) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-md border border-border bg-white p-5 shadow-card">
          <p className="text-[15px] font-semibold text-text">Before you continue</p>
          <div className="mt-2.5 max-h-52 overflow-y-auto rounded-md border border-border-2 bg-surface-3 p-3 text-[12px] leading-relaxed text-text-2">
            <p className="mb-2">
              {party.contractName} is being signed electronically. By checking the box below and continuing, you agree
              that your electronic signature is legally binding, just like a signature on paper, under the U.S. ESIGN
              Act and applicable state law.
            </p>
            <p className="mb-2">
              You have the right to receive this document on paper instead — contact whoever sent it to you to request
              that. You can also withdraw this consent at any time before you finish signing, simply by closing this
              page without submitting.
            </p>
            <p>
              You'll need a device with a modern web browser and an internet connection to view and sign this
              document — nothing else is required.
            </p>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[12.5px] text-text-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            I have read the above and agree to sign this document electronically.
          </label>
          <button
            className="btn btn-primary mt-3 w-full !py-2.5 text-[14px]"
            disabled={!consentChecked || !token || recordConsent.isPending}
            onClick={() =>
              token && recordConsent.mutate(token, { onSuccess: () => setJustConsented(true) })
            }
          >
            {recordConsent.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
            {recordConsent.isPending ? 'Continuing…' : 'Agree & Continue'}
          </button>
          {recordConsent.isError && (
            <p className="mt-2 text-[12px] text-danger">{(recordConsent.error as Error).message}</p>
          )}
        </div>
      </div>
    );
  }

  const roleName = roleLabel(party.role, party.templateType, party.templatePartyRoles);
  const showName = party.name && party.name.toLowerCase() !== roleName.toLowerCase();

  return (
    <div className="min-h-screen bg-bg pb-36">
      {/* Sticky header — brand + doc identity stay visible while scrolling a
          long contract, and the field counter gives a sense of progress. */}
      <div className="sticky top-0 z-10 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileSignature size={16} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text">{party.contractName}</div>
              <div className="truncate text-[11.5px] text-text-3">
                Signing as <span className="font-medium text-text-2">{roleName}</span>
                {showName ? ` — ${party.name}` : ''}
              </div>
            </div>
          </div>
          {myPendingFields.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-primary">
              {filledCount}/{myPendingFields.length} fields
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[720px] px-4 py-5">
        {myPendingFields.length > 0 && (
          <p className="mb-4 text-[13px] text-text-3">Fill in the highlighted fields below, then {needsSignature ? 'sign' : 'confirm'}.</p>
        )}

        {!pdf ? (
          <div className="flex h-96 items-center justify-center rounded-md border border-border bg-white">
            <Loader2 size={20} className="animate-spin text-text-3" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            {pageNums.map((n) => (
              <ContractDocumentPage
                key={n}
                pdf={pdf}
                pageNum={n}
                pageWidth={pageWidth}
                fields={party.templateFields}
                fieldValues={party.fieldValues}
                signatures={party.otherSignatures}
                activeRole={party.role}
                docType={party.templateType}
                partyRoles={party.templatePartyRoles}
                editableValues={fieldInputs}
                onEditableChange={(id, value) => setFieldInputs((prev) => ({ ...prev, [id]: value }))}
              />
            ))}
          </div>
        )}

        {needsSignature ? (
          <div className="rounded-md border border-border bg-white p-4 shadow-card">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-text">Your signature</div>
              <div className="flex rounded-md border border-border-2 p-0.5">
                <button
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    signatureMode === 'draw' ? 'bg-primary text-white' : 'text-text-3 hover:text-text'
                  }`}
                  onClick={() => setSignatureMode('draw')}
                >
                  <PenLine size={12} /> Draw
                </button>
                <button
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    signatureMode === 'type' ? 'bg-primary text-white' : 'text-text-3 hover:text-text'
                  }`}
                  onClick={() => setSignatureMode('type')}
                >
                  <Type size={12} /> Type
                </button>
              </div>
            </div>

            {signatureMode === 'draw' ? (
              <>
                <div className="relative h-32 overflow-hidden rounded-md border border-dashed border-border-2 bg-surface-3">
                  <SignaturePad ref={padRef} onChange={setHasDrawing} />
                  {!hasDrawing && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11.5px] text-text-3">
                      Sign above with your finger, stylus, or mouse
                    </span>
                  )}
                </div>
                <button
                  className="mt-1.5 text-[11.5px] font-medium text-text-3 hover:text-text disabled:opacity-40"
                  disabled={!hasDrawing}
                  onClick={() => padRef.current?.clear()}
                >
                  Clear
                </button>
              </>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Type your full name"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                />
                <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-border-2 bg-surface-3">
                  <span style={{ fontFamily: `"${SIGNATURE_FONT}", cursive`, fontSize: 40, color: '#111827' }}>{signatureName || ' '}</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-white p-4 shadow-card">
            <p className="text-[13px] text-text-2">Nothing here needs your signature — just confirm below once you've reviewed everything above.</p>
          </div>
        )}

        <div className="mt-4 text-center">
          {!declineOpen ? (
            <button className="text-[12px] font-medium text-text-3 hover:text-text-2" onClick={() => setDeclineOpen(true)}>
              I can't sign this
            </button>
          ) : (
            <div className="rounded-md border border-dashed border-border-2 bg-surface-3 p-3 text-left">
              <p className="mb-2 text-[12.5px] text-text-2">
                Let us know why — this stops the document for everyone, so whoever sent it can follow up.
              </p>
              <textarea
                className="input min-h-16 text-[13px]"
                placeholder="Optional — what's the issue?"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <button className="text-[12px] font-medium text-text-3 hover:text-text-2" onClick={() => setDeclineOpen(false)}>
                  Never mind
                </button>
                <button
                  className="btn !bg-danger !text-white !py-1.5 !px-3 text-[12.5px] disabled:opacity-50"
                  disabled={declineSignature.isPending}
                  onClick={() =>
                    token &&
                    declineSignature.mutate(
                      { token, reason: declineReason.trim() || undefined },
                      { onSuccess: () => setDeclined(true) },
                    )
                  }
                >
                  {declineSignature.isPending ? 'Submitting…' : 'Confirm decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom action bar — the submit button stays reachable on a
          long, multi-page contract instead of requiring a scroll back down.
          Bottom padding adds the iPhone home-indicator safe area so the
          button never sits underneath it. */}
      <div
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-white/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-[720px]">
          {!allFieldsFilled && <p className="mb-1.5 text-[12px] text-warning">Fill in every highlighted field above before continuing.</p>}
          <button
            className="btn btn-primary w-full !py-2.5 text-[14px]"
            disabled={!canSubmit || submitSignature.isPending}
            onClick={handleSubmit}
          >
            {submitSignature.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
            {submitSignature.isPending ? 'Submitting…' : needsSignature ? 'Sign & Submit' : 'Confirm & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
