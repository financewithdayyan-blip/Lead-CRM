import { useParams } from 'react-router-dom';
import { Download, FileText, Loader2 } from 'lucide-react';
import { usePublicLoi } from '@/hooks/useGeneratedLois';
import { downloadLoiPdf } from '@/lib/loiPdf';
import { formatDate } from '@/lib/utils';

export function PublicLoiPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: loi, isLoading, isError } = usePublicLoi(slug);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (isError || !loi) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div>
          <FileText size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 text-slate-500">This letter is no longer available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <img src="/logo-mark.svg" alt="BlueBird Acquisition" className="h-8 w-auto" />
          <button
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => downloadLoiPdf(loi.body, `LOI - ${loi.leadName || 'letter'}`)}
          >
            <Download size={14} /> Download PDF
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
          {loi.propertyAddress && (
            <div className="mb-6 text-[13px] text-slate-400">
              {loi.propertyAddress} · {formatDate(loi.createdAt)}
            </div>
          )}
          <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-slate-800">{loi.body}</div>
        </div>
      </div>
    </div>
  );
}
