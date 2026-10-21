import { useEffect, useState } from "react";
import { screenshotsAPI } from "../services/api";

// El binario de una captura solo se sirve por /api/screenshots/:id/image, que exige el header
// Authorization. Un <img src="..."> no manda ese header, así que se descarga como Blob autenticado
// y se muestra con un object URL.
export function useAuthorizedScreenshot(id?: string | null): {
  url: string | null;
  loading: boolean;
  error: string | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);

    screenshotsAPI
      .imageBlob(id)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la imagen");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setUrl(null);
    };
  }, [id]);

  return { url, loading, error };
}
