import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Loader2,
  PenLine,
  Plus,
  Trash2,
  Type,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { loadPdf, renderPdfPageToCanvas, type pdfjsLib } from '@/lib/pdfjs';
import {
  useSaveContractMapping,
  roleLabel,
  roleColor,
  type ContractField,
  type ContractFieldType,
  type DocTemplate,
  type PartyRoleDef,
} from '@/hooks/useDocTemplates';

const BASE_WIDTH = 760;
const ZOOM_STEPS = [0.6, 0.75, 1, 1.25, 1.5, 1.75, 2];
const DEFAULT_ZOOM_INDEX = 2; // 1x

const FIELD_DEFAULTS: Record<ContractFieldType, { w: number; h: number; label: string }> = {
  text: { w: 16, h: 3.5, label: 'Text field' },
  full_name: { w: 18, h: 3.5, label: 'Full name' },
  currency: { w: 13, h: 3.5, label: 'Amount' },
  date: { w: 12, h: 3.5, label: 'Date' },
  paragraph: { w: 32, h: 12, label: 'Clause' },
  signature: { w: 20, h: 6, label: 'Signature' },
};

const FIELD_TYPE_BUTTONS: Array<{ type: ContractFieldType; label: string; icon: typeof Type }> = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'full_name', label: 'Full Name', icon: User },
  { type: 'currency', label: 'Currency', icon: DollarSign },
  { type: 'date', label: 'Date', icon: Calendar },
  { type: 'paragraph', label: 'Paragraph', icon: AlignLeft },
  { type: 'signature', label: 'Signature', icon: PenLine },
];

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
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fields, setFields] = useState<ContractField[]>(template.fields);
  const [name, setName] = useState(template.name);
  const [partyRoles, setPartyRoles] = useState<PartyRoleDef[]>(template.partyRoles);
  const [placingType, setPlacingType] = useState<ContractFieldType | null>(null);
  const [placingRole, setPlacingRole] = useState<string>('seller');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState('');

  const zoom = ZOOM_STEPS[zoomIndex];
  const canvasWidth = Math.round(BASE_WIDTH * zoom);

  // Seller/buyer are always available; anything the template itself defines
  // rides after them in the order they were added.
  const roles = ['seller', 'buyer', ...partyRoles.map((r) => r.id)];

  function confirmAddRole() {
    const label = newRoleLabel.trim();
    if (!label) return;
    const id = `extra_${Date.now()}`;
    setPartyRoles((prev) => [...prev, { id, label }]);
    setPlacingRole(id);
    setNewRoleLabel('');
    setAddingRole(false);
  }

  function removeRole(id: string) {
    // Fields already placed under this role would be orphaned — a deleted
    // party with nothing to sign is worse than a role that lingers unused.
    if (fields.some((f) => f.role === id)) return;
    setPartyRoles((prev) => prev.filter((r) => r.id !== id));
    if (placingRole === id) setPlacingRole('seller');
  }

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
    renderPdfPageToCanvas(pdf, pageNum, canvasWidth).then(({ canvas }) => {
      const container = containerRef.current;
      if (!container) return;
      container.querySelectorAll('canvas').forEach((c) => c.remove());
      container.insertBefore(canvas, container.firstChild);
      setLoadingPage(false);
    });
  }, [pdf, pageNum, canvasWidth]);

  // Escape cancels an active placement instead of closing the whole editor —
  // losing a half-mapped document to a stray Escape press would be a much
  // worse outcome than the key doing nothing extra.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (e.key === 'Escape' && placingType) {
        setPlacingType(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        e.preventDefault();
        setFields((prev) => prev.filter((f) => f.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [placingType, selectedId]);

  const pageFields = fields.filter((f) => f.page === pageNum);
  const numPages = pdf?.numPages ?? 1;
  const pageNumbers = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

  // Fields grouped and ordered by page, so a long multi-page contract reads
  // as a document outline instead of one flat, order-of-creation list.
  const fieldsByPage = useMemo(() => {
    const map = new Map<number, ContractField[]>();
    for (const f of fields) {
      if (!map.has(f.page)) map.set(f.page, []);
      map.get(f.page)!.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [fields]);

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

  function deleteField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveMapping.mutateAsync({ id: template.id, name: name.trim(), fields, partyRoles });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const selected = fields.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* ── Top bar — name, field palette, role palette, and the two exits
          (Cancel/Save) all live here so nothing requires scrolling to reach. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-4 py-2.5 shadow-sm">
        <input
          className="input !w-52 shrink-0"
          placeholder="Template name (e.g. PSA Cash)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="h-6 w-px shrink-0 bg-border-2" />
        {FIELD_TYPE_BUTTONS.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            className={`btn !px-2.5 !py-1.5 text-[12px] ${placingType === type ? 'btn-primary' : ''}`}
            onClick={() => setPlacingType(placingType === type ? null : type)}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <div className="h-6 w-px shrink-0 bg-border-2" />
        <span className="shrink-0 text-[12px] text-text-3">Placing as:</span>
        {roles.map((r) => (
          <span key={r} className="group relative inline-flex items-center">
            <button
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${placingRole === r ? 'text-white' : 'bg-surface-3 text-text-2'}`}
              style={placingRole === r ? { background: roleColor(r) } : undefined}
              onClick={() => setPlacingRole(r)}
            >
              {roleLabel(r, template.type, partyRoles)}
            </button>
            {r !== 'seller' && r !== 'buyer' && !fields.some((f) => f.role === r) && (
              <button className="ml-0.5 text-text-3 hover:text-danger" title="Remove this signee" onClick={() => removeRole(r)}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {addingRole ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              className="input !w-32 !py-1 text-[12px]"
              placeholder="e.g. Witness"
              value={newRoleLabel}
              onChange={(e) => setNewRoleLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmAddRole();
                if (e.key === 'Escape') setAddingRole(false);
              }}
            />
            <button className="btn !p-1.5" disabled={!newRoleLabel.trim()} onClick={confirmAddRole}>
              <Check size={12} />
            </button>
            <button className="btn !p-1.5" onClick={() => setAddingRole(false)}>
              <X size={12} />
            </button>
          </span>
        ) : (
          <button className="btn !px-2 !py-1 text-[11px]" onClick={() => setAddingRole(true)}>
            <Plus size={12} /> Add Signee
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button className="btn !px-3 !py-1.5 text-[13px]" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary !px-3 !py-1.5 text-[13px]" disabled={!name.trim() || saving} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save mapping
          </button>
        </div>
      </div>

      {/* ── Main workspace — canvas on the left (its own toolbar for page nav
          and zoom), field list on the right. Both scroll independently so a
          long document and a long field list never fight over one scrollbar. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-4 py-2">
            <div className="flex items-center gap-1.5">
              <button className="btn !p-1.5" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              {numPages <= 10 ? (
                <div className="flex items-center gap-1">
                  {pageNumbers.map((n) => (
                    <button
                      key={n}
                      onClick={() => setPageNum(n)}
                      className={`flex h-6 w-6 items-center justify-center rounded text-[11px] font-medium ${
                        n === pageNum ? 'bg-primary text-white' : 'text-text-3 hover:bg-surface-3 hover:text-text'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[12px] text-text-2">
                  Page {pageNum} / {numPages}
                </span>
              )}
              <button className="btn !p-1.5" disabled={pageNum >= numPages} onClick={() => setPageNum((p) => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {placingType && <span className="text-[12px] font-medium text-primary">Click on the document to place the field</span>}
              <div className="flex items-center gap-0.5 rounded-md border border-border-2 p-0.5">
                <button className="btn !border-0 !p-1" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
                  <ZoomOut size={13} />
                </button>
                <span className="w-10 text-center text-[11.5px] tabular-nums text-text-2">{Math.round(zoom * 100)}%</span>
                <button
                  className="btn !border-0 !p-1"
                  disabled={zoomIndex === ZOOM_STEPS.length - 1}
                  onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                >
                  <ZoomIn size={13} />
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-surface-2 px-6 py-6">
            <div
              ref={containerRef}
              onClick={handleCanvasClick}
              className={`relative mx-auto overflow-hidden rounded-md border border-border-2 bg-white shadow-card ${placingType ? 'cursor-crosshair' : ''}`}
              style={{ width: canvasWidth }}
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
                  onClick={(e) => e.stopPropagation()}
                  className="absolute cursor-move rounded-sm border-2"
                  style={{
                    left: `${f.xPct}%`,
                    top: `${f.yPct}%`,
                    width: `${f.wPct}%`,
                    height: `${f.hPct}%`,
                    borderColor: roleColor(f.role),
                    background: `${roleColor(f.role)}22`,
                    boxShadow: selectedId === f.id ? `0 0 0 2px ${roleColor(f.role)}` : undefined,
                  }}
                >
                  <span className="pointer-events-none block truncate px-1 text-[9px] font-semibold" style={{ color: roleColor(f.role) }}>
                    {f.label}
                  </span>
                  <div
                    onMouseDown={(e) => startDrag(e, f, 'resize')}
                    className="absolute bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize rounded-tl bg-current"
                    style={{ color: roleColor(f.role) }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex w-72 shrink-0 flex-col border-l border-border bg-white">
          <div className="border-b border-border p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Selected field</div>
            {!selected ? (
              <p className="mt-2 text-[12px] text-text-3">
                Click a field on the document to edit it, or pick a field type above and click the document to add one.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                <input className="input" value={selected.label} onChange={(e) => updateSelected({ label: e.target.value })} placeholder="Label" />
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r) => (
                    <button
                      key={r}
                      className="flex-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-semibold text-white"
                      style={{ background: selected.role === r ? roleColor(r) : '#cbd5e1' }}
                      onClick={() => updateSelected({ role: r })}
                    >
                      {roleLabel(r, template.type, partyRoles)}
                    </button>
                  ))}
                </div>
                <button className="btn btn-danger w-full !py-1 text-[12px]" onClick={() => deleteField(selected.id)}>
                  <Trash2 size={12} /> Delete field
                  <span className="ml-1 text-[10px] opacity-75">(Del)</span>
                </button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">All fields ({fields.length})</div>
            {fieldsByPage.length === 0 ? (
              <p className="mt-2 text-[12px] text-text-3">No fields placed yet.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {fieldsByPage.map(([page, pageFieldList]) => (
                  <div key={page}>
                    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
                      Page {page} <span className="font-normal normal-case text-text-3/70">· {pageFieldList.length}</span>
                    </div>
                    <div className="space-y-1">
                      {pageFieldList.map((f) => (
                        <div
                          key={f.id}
                          className={`group flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                            selectedId === f.id ? 'border-primary' : 'border-border-2'
                          }`}
                        >
                          <button
                            className="min-w-0 flex-1 truncate text-left"
                            style={{ color: roleColor(f.role) }}
                            onClick={() => {
                              setPageNum(f.page);
                              setSelectedId(f.id);
                            }}
                          >
                            {f.label}
                          </button>
                          <button
                            className="shrink-0 text-text-3 opacity-0 hover:text-danger group-hover:opacity-100"
                            title="Delete this field"
                            onClick={() => deleteField(f.id)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
