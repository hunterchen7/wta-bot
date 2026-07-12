import { useEffect } from 'react';

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · WTA`;
  }, [title]);
}

export function DocumentTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}
