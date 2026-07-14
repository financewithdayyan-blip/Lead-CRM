import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const storageKey = (userId: string) => `bluebird_biz_card_${userId}`;

export function useBusinessCard() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [cardDataUrl, setCardDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const stored = localStorage.getItem(storageKey(userId));
    setCardDataUrl(stored);
  }, [userId]);

  const saveCard = useCallback(
    async (file: File): Promise<void> => {
      if (!userId) return;
      // Normalize to PNG via canvas so ClipboardItem always gets image/png
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d')!.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = reject;
          img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      localStorage.setItem(storageKey(userId), dataUrl);
      setCardDataUrl(dataUrl);
    },
    [userId],
  );

  const removeCard = useCallback(() => {
    if (!userId) return;
    localStorage.removeItem(storageKey(userId));
    setCardDataUrl(null);
  }, [userId]);

  const copyCardToClipboard = useCallback(async (): Promise<void> => {
    if (!cardDataUrl) return;
    const res = await fetch(cardDataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, [cardDataUrl]);

  return { cardDataUrl, saveCard, removeCard, copyCardToClipboard };
}
