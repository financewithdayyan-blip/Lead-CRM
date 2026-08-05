import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Trash2, Type, Calendar, PenLine, User, DollarSign, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { loadPdf, renderPdfPageToCanvas, type pdfjsLib } from '@/lib/pdfjs';
import { useSaveContractMapping, type ContractField, type ContractFieldRole, type ContractFieldType, type DocTemplate } from '@/hooks/useDocTemplates';

const CANVAS_WIDTH = 700;

const FIELD_DEFAULTS: Record<ContractFieldType, { w: number; h: number; label: string }> = {
  text: { w: 16, h: 3.5, label: 'Text field' },
  full_name: { w: 18, h: 3.5, label: 'Full name' },
  currency: { w: 13, h: 3.5, label: 'Amount' },
  date: { w: 12, h: 3.5, label: 'Date' },
  signature: { w: 20, h: 6, label: 'Signature' },
};

const FIELD_TYPE_BUTTONS: Array<{ type: ContractFieldType; label: string; icon: typeof Type }> = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'full_name', label: 'Full Name', icon: User },
  { type: 'currency', label: 'Currency', icon: DollarSign },
  { type: 'date', label: 'Date', icon: Calendar },
  { type: 'signature', label: 'Signature', icon: PenLine },
];

const ROLE_COLOR: Record<ContractFieldRole, string> = {
  buyer: '#0ea5e9',
  seller: '#a78bfa',
};

interface DragState {
  fieldId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origXPct: number;
  origYPct: number;
  origWPct: number;
  origHPct: number;
}

export function ContractFieldMapper({
  template,
  pdfUrl,
  onClose,
  onSaved,
}: {
  template: DocTemplate;
  pdfUrl: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [loadingPage, setLoadingPage] = useState(true);
  const [fields, setFields] = useState<ContractField[]>(template.fields);
  const [name, setName] = useState(template.name);
  const [placingType, setPlacingType] = useState<ContractFieldType | null>(null);
  const [placingRole, setPlacingRole] = useState<ContractFieldRole>('seller');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const saveMapping = useSaveContractMapping();

  useEffect(() => {
    let cancelled = false;
    loadPdf(pdfUrl).then((doc) => {
      if (!cancelled) setPdf(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    setLoadingPage(true);
    renderPdfPageToCanvas(pdf, pageNum, CANVAS_WIDTH).then(({ canvas }) => {
      const container = containerRef.current;
      if (!container) return;
      container.querySelectorAll('canvas').forEach((c) => c.remove());
      container.insertBefore(canvas, container.firstChild);
      setLoadingPage(false);
    });
  }, [pdf, pageNum]);

  const pageFields = fields.filter((f) => f.page === pageNum);

  function addField(clickXPct: number, clickYPct: number) {
    if (!placingType) return;
    const d = FIELD_DEFAULTS[placingType];
    const field: ContractField = {
      id: crypto.randomUUID(),
      page: pageNum,
      xPct: Math.min(Math.max(clickXPct - d.w / 2, 0), 100 - d.w),
      yPct: Math.min(Math.max(clickYPct - d.h / 2, 0), 100 - d.h),
      wPct: d.w,
      hPct: d.h,
      type: placingType,
      role: placingRole,
      label: d.label,
    };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
    setPlacingType(null);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placingType || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    addField(xPct, yPct);
  }

  function startDrag(e: React.MouseEvent, field: ContractField, mode: 'move' | 'resize') {
    e.stopPropagation();
    setSelectedId(field.id);
    dragRef.current = {
      fieldId: field.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origXPct: field.xPct,
      origYPct: field.yPct,
      origWPct: field.wPct,
      origHPct: field.hPct,
    };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e: MouseEvent) {
    const drag = dragRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const dxPct = ((e.clientX - drag.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - drag.startY) / rect.height) * 100;

    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== drag.fieldId) return f;
        if (drag.mode === 'move') {
          return {
            ...f,
            xPct: Math.min(Math.max(drag.origXPct + dxPct, 0), 100 - f.wPct),
            yPct: Math.min(Math.max(drag.origYPct + dyPct, 0), 100 - f.hPct),
          };
        }
        return {
          ...f,
          wPct: Math.min(Math.max(drag.origWPct + dxPct, 4), 100 - f.xPct),
          hPct: Math.min(Math.max(drag.origHPct + dyPct, 2), 100 - f.yPct),
        };
      }),
    );
  }

  function onDragEnd() {
    dragRef.current = null;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }

  function updateSelected(patch: Partial<ContractField>) {
    setFields((prev) => prev.map((f) => (f.id === selectedId ? { ...f, ...patch } : f)));
  }

  function deleteSelected() {
    setFields((prev) => prev.filter((f) => f.id !== selectedId));
    setSelectedId(null);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveMapping.mutateAsync({ id: template.id, name: name.trim(), fields });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const numPages = pdf?.numPages ?? 1;

  return (
    <Modal open onClose={onClose} title="Map contract fields" width="xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[240px]"
          placeholder="Template name (e.g. PSA Cash)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mx-1 h-5 w-px bg-border-2" />
        {FIELD_TYPE_BUTTONS.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            className={`btn !px-2.5 !py-1.5 text-[12px] ${placingType === type ? 'btn-primary' : ''}`}
            onClick={() => setPlacingType(placingType === type ? null : type)}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px bg-border-2" />
        <span className="text-[12px] text-text-3">Placing as:</span>
        <button
          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${placingRole === 'seller' ? 'text-white' : 'bg-surface-3 text-text-2'}`}
          style={placingRole === 'seller' ? { background: ROLE_COLOR.seller } : undefined}
          onClick={() => setPlacingRole('seller')}
        >
          Seller
        </button>
        <button
          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${placingRole === 'buyer' ? 'text-white' : 'bg-surface-3 text-text-2'}`}
          style={placingRole === 'buyer' ? { background: ROLE_COLOR.buyer } : undefined}
          onClick={() => setPlacingRole('buyer')}
        >
          Buyer
        </button>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button className="btn !p-1.5" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-[12px] text-text-2">
                Page {pageNum} / {numPages}
              </span>
              <button className="btn !p-1.5" disabled={pageNum >= numPages} onClick={() => setPageNum((p) => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
            {placingType && <span className="text-[12px] font-medium text-primary">Click on the document to place the field</span>}
          </div>

          <div
            ref={containerRef}
            onClick={handleCanvasClick}
            className={`relative overflow-hidden rounded-md border border-border-2 ${placingType ? 'cursor-crosshair' : ''}`}
            style={{ width: CANVAS_WIDTH }}
          >
            {loadingPage && (
              <div className="flex h-96 items-center justify-center text-text-3">
                <Loader2 size={20} className="animate-spin" />
              </div>
            )}
            {pageFields.map((f) => (
              <div
                key={f.id}
                onMouseDown={(e) => startDrag(e, f, 'move')}
                className="absolute cursor-move rounded-sm border-2"
                style={{
                  left: `${f.xPct}%`,
                  top: `${f.yPct}%`,
                  width: `${f.wPct}%`,
                  height: `${f.hPct}%`,
                  borderColor: ROLE_COLOR[f.role],
                  background: `${ROLE_COLOR[f.role]}22`,
                  boxShadow: selectedId === f.id ? `0 0 0 2px ${ROLE_COLOR[f.role]}` : undefined,
                }}
              >
                <span
                  className="pointer-events-none block truncate px-1 text-[9px] font-semibold"
                  style={{ color: ROLE_COLOR[f.role] }}
                >
                  {f.label}
                </span>
                <div
                  onMouseDown={(e) => startDrag(e, f, 'resize')}
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize rounded-tl bg-current"
                  style={{ color: ROLE_COLOR[f.role] }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="w-56 shrink-0">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-text-3">Selected field</div>
          {!selected ? (
            <p className="mt-2 text-[12px] text-text-3">Click a field on the document to edit it, or pick a field type above and click the document to add one.</p>
          ) : (
            <div className="mt-2 space-y-2">
              <input
                className="input"
                value={selected.label}
                onChange={(e) => updateSelected({ label: e.target.value })}
                placeholder="Label"
              />
              <div className="flex gap-1.5">
                <button
                  className="flex-1 rounded-md px-2 py-1 text-[12px] font-semibold text-white"
                  style={{ background: selected.role === 'seller' ? ROLE_COLOR.seller : '#cbd5e1' }}
                  onClick={() => updateSelected({ role: 'seller' })}
                >
                  Seller
                </button>
                <button
                  className="flex-1 rounded-md px-2 py-1 text-[12px] font-semibold text-white"
                  style={{ background: selected.role === 'buyer' ? ROLE_COLOR.buyer : '#cbd5e1' }}
                  onClick={() => updateSelected({ role: 'buyer' })}
                >
                  Buyer
                </button>
              </div>
              <button className="btn btn-danger w-full !py-1 text-[12px]" onClick={deleteSelected}>
                <Trash2 size={12} /> Delete field
              </button>
            </div>
          )}

          <div className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-text-3">All fields ({fields.length})</div>
          <div className="mt-1.5 space-y-1">
            {fields.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setPageNum(f.page);
                  setSelectedId(f.id);
                }}
                className={`flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-left text-[11px] ${selectedId === f.id ? 'border-primary' : 'border-border-2'}`}
              >
                <span className="truncate" style={{ color: ROLE_COLOR[f.role] }}>
                  {f.label}
                </span>
                <span className="shrink-0 text-text-3">p{f.page}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          <X size={14} /> Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim() || saving} onClick={handleSave}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Save mapping
        </button>
      </div>
    </Modal>
  );
}
