import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { blogCoverPublicUrl, useUploadCoverImage } from '@/hooks/useBlogPosts';

export function CoverImageUpload({
  path,
  onChange,
}: {
  path: string | null;
  onChange: (path: string | null) => void;
}) {
  const upload = useUploadCoverImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = blogCoverPublicUrl(path);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const uploadedPath = await upload.mutateAsync(file);
      onChange(uploadedPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {previewUrl ? (
        <div className="relative w-full max-w-sm overflow-hidden rounded-md border border-border-2">
          <img src={previewUrl} alt="Cover" className="aspect-video w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 rounded-full bg-slate-900/70 p-1.5 text-white hover:bg-slate-900"
            title="Remove cover image"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="flex aspect-video w-full max-w-sm flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-2 text-text-3 hover:border-primary hover:text-primary"
        >
          {upload.isPending ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
          <span className="text-[12px] font-medium">{upload.isPending ? 'Uploading…' : 'Upload cover image'}</span>
        </button>
      )}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
