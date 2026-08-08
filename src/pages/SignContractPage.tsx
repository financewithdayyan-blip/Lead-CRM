import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Download, FileText, Loader2 } from 'lucide-react';
import {
  usePublicSigningParty,
  useSigningPdfUrl,
  useSubmitSignature,
  useLogSigningView,
  useSignedFinalDocUrl,
} from '@/hooks/useContractInstances';
import { loadPdf, type pdfjsLib } from '@/lib/pdfjs';
import { ContractDocumentPage } from '@/components/bluedocs/ContractDocumentPreview';
import { formatCurrency } from '@/lib/currency';
import { loadSignatureFont, renderTypedSignature, SIGNATURE_FONT } from '@/lib/typedSignature';
import { roleLabel } from '@/hooks/useDocTemplates';

const PAGE_WIDTH = 680;
const FILLABLE_TYPES = new Set(['text', 'full_name', 'currency', 'date', 'paragraph']);

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
      className="mt-4 flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
  const logView = useLogSigningView();

  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [justCompletedAll, setJustCompletedAll] = useState(false);
  const [fieldInputs, setFieldInputs] = useState<Record<string, string>>({});
  const [signatureName, setSignatureName] = useState('');
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

  const allFieldsFilled = myPendingFields.every((f) => fieldInputs[f.id]?.trim());
  const canSubmit = allFieldsFilled && (!needsSignature || !!signatureName.trim());

  async function handleSubmit() {
    if (!token || !canSubmit) return;
    const dataUrl = needsSignature ? await renderTypedSignature(signatureName.trim()) : undefined;
    const formatted = { ...fieldInputs };
    for (const f of myPendingFields) {
      if (f.type === 'currency' && formatted[f.id]) formatted[f.id] = formatCurrency(formatted[f.id]);
    }
    const result = await submitSignature.mutateAsync({ token, signatureDataUrl: dataUrl, fieldValues: formatted });
    setJustCompletedAll(result.allSigned);
    setSubmitted(true);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (isError || !party) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div>
          <FileText size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 text-slate-500">This signing link is no longer valid.</p>
        </div>
      </div>
    );
  }

  if (submitted || party.status === 'signed') {
    const docLabel = party.templateType === 'loi' ? 'LOI' : 'Contract';
    const fullyDone = justCompletedAll || party.contractStatus === 'signed';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 text-center">
        <SignSuccessCheck />
        <p className="mt-3 text-lg font-semibold text-slate-800">
          You've {needsSignature ? 'signed' : 'confirmed'} {party.contractName}
        </p>
        <p className="mt-1 text-slate-500">
          {fullyDone
            ? 'Every party has completed this document — you can download the final copy below.'
            : "Thank you — you'll be notified once every party has completed signing."}
        </p>
        {fullyDone && token && <DownloadCertificateButton token={token} docLabel={docLabel} />}
      </div>
    );
  }

  if (!party.isTurn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div>
          <Clock size={32} className="mx-auto text-slate-400" />
          <p className="mt-3 text-lg font-semibold text-slate-800">Waiting on {party.waitingOn}</p>
          <p className="mt-1 text-slate-500">
            {party.waitingOn} needs to sign {party.contractName} before it's your turn. This page will update automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-slate-800">{party.contractName}</h1>
          <p className="text-[13px] text-slate-500">
            Signing as <span className="font-medium">{roleLabel(party.role, party.templateType, party.templatePartyRoles)}</span>
            {party.name && party.name.toLowerCase() !== roleLabel(party.role, party.templateType, party.templatePartyRoles).toLowerCase()
              ? ` — ${party.name}`
              : ''}
            {myPendingFields.length > 0 ? ` — fill in the highlighted fields below, then ${needsSignature ? 'sign' : 'confirm'}.` : ''}
          </p>
        </div>

        {!pdf ? (
          <div className="flex h-96 items-center justify-center rounded-md border border-slate-200 bg-white">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : (
          pageNums.map((n) => (
            <ContractDocumentPage
              key={n}
              pdf={pdf}
              pageNum={n}
              pageWidth={PAGE_WIDTH}
              fields={party.templateFields}
              fieldValues={party.fieldValues}
              signatures={party.otherSignatures}
              activeRole={party.role}
              docType={party.templateType}
              partyRoles={party.templatePartyRoles}
              editableValues={fieldInputs}
              onEditableChange={(id, value) => setFieldInputs((prev) => ({ ...prev, [id]: value }))}
            />
          ))
        )}

        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          {needsSignature ? (
            <>
              <div className="mb-2 text-[13px] font-semibold text-slate-700">Your signature</div>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-slate-500"
                placeholder="Type your full name"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
              />
              <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50">
                <span style={{ fontFamily: `"${SIGNATURE_FONT}", cursive`, fontSize: 40, color: '#111827' }}>
                  {signatureName || ' '}
                </span>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-slate-600">
              Nothing here needs your signature — just confirm below once you've reviewed everything above.
            </p>
          )}
          {!allFieldsFilled && (
            <p className="mt-2 text-[12px] text-amber-600">Fill in every highlighted field above before continuing.</p>
          )}
          <button
            className="mt-3 w-full rounded-md bg-slate-900 py-2.5 text-[14px] font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canSubmit || submitSignature.isPending}
            onClick={handleSubmit}
          >
            {submitSignature.isPending ? 'Submitting…' : needsSignature ? 'Sign & Submit' : 'Confirm & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
